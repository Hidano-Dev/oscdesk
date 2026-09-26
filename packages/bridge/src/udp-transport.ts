import dgram from 'node:dgram'

import type { RemoteInfo, Socket } from 'node:dgram'

import {
  OSC_BATCH,
  OSC_IMMEDIATE_TIME_TAG,
  type OscArg,
  type OscBundlePacket,
  type OscMessagePacket,
  type OscPacket,
} from '@oscdesk/shared'
import { decodeOscPacket, encodeOscPacket } from '@oscdesk/osc-codec'

import type { BundleSendResult, InboundOscMessage } from './surface-core'

export interface UdpTransport {
  readonly port: number
  send(host: string, port: number, address: string, args: readonly OscArg[]): void
  sendBundle(host: string, port: number, messages: readonly OscMessagePacket[]): BundleSendResult
  close(): Promise<void>
}

export interface UdpTransportOptions {
  host?: string
  port: number
  onMessage: (message: InboundOscMessage) => void
  onDecodeError: (error: unknown, from: { host: string; port: number }) => void
  onSocketError: (error: Error) => void
}

export async function startUdpTransport(options: UdpTransportOptions): Promise<UdpTransport> {
  const socket = dgram.createSocket('udp4')
  const host = options.host ?? '0.0.0.0'

  socket.on('message', (data, remote) => {
    handleIncomingPacket(data, remote, options)
  })

  await bindSocket(socket, options.port, host)
  socket.on('error', options.onSocketError)

  const address = socket.address()
  const port = typeof address === 'string' ? options.port : address.port

  return {
    port,
    send(targetHost, targetPort, address, args) {
      const payload = encodeOscPacket({ address, args: [...args] })
      void sendPacket(socket, payload, targetPort, targetHost).catch(options.onSocketError)
    },
    sendBundle(targetHost, targetPort, messages) {
      const payload = encodeOscPacket({
        timeTag: OSC_IMMEDIATE_TIME_TAG,
        packets: messages.map((message) => ({
          address: message.address,
          args: [...message.args],
        })),
      })

      if (payload.byteLength > OSC_BATCH.PRACTICAL_LIMIT_BYTES) {
        return {
          ok: false,
          reason: 'too-large',
          bytes: payload.byteLength,
          limitBytes: OSC_BATCH.PRACTICAL_LIMIT_BYTES,
        }
      }

      void sendPacket(socket, payload, targetPort, targetHost).catch(options.onSocketError)
      return { ok: true, bytes: payload.byteLength, messageCount: messages.length }
    },
    close() {
      return closeSocket(socket)
    },
  }
}

function handleIncomingPacket(
  data: Buffer,
  remote: RemoteInfo,
  options: UdpTransportOptions,
): void {
  let packet: OscPacket

  try {
    packet = decodeOscPacket(data)
  } catch (error) {
    options.onDecodeError(error, { host: remote.address, port: remote.port })
    return
  }

  for (const message of flattenMessages(packet)) {
    options.onMessage({
      address: message.address,
      args: message.args,
      from: { host: remote.address, port: remote.port },
    })
  }
}

function flattenMessages(packet: OscPacket): OscMessagePacket[] {
  if (isBundle(packet)) {
    return packet.packets.flatMap(flattenMessages)
  }

  return [packet]
}

function isBundle(packet: OscPacket): packet is OscBundlePacket {
  return 'packets' in packet
}

function bindSocket(socket: Socket, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleListening = () => {
      cleanup()
      resolve()
    }

    const handleError = (error: Error) => {
      cleanup()
      socket.close(() => reject(error))
    }

    const cleanup = () => {
      socket.off('listening', handleListening)
      socket.off('error', handleError)
    }

    socket.once('listening', handleListening)
    socket.once('error', handleError)
    socket.bind(port, host)
  })
}

function closeSocket(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.close(() => {
      resolve()
    })
  })
}

function sendPacket(socket: Socket, payload: Uint8Array, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(payload, port, host, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}
