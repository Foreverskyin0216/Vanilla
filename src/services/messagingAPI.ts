import { messagingApi } from '@line/bot-sdk'
import { getParameter } from './ssm'

export type Message = messagingApi.ImageMessage | messagingApi.TextMessage

export const reply = async (replyToken: string, messages: Message[]) => {
  const channelAccessToken = await getParameter('/vanilla/line/channelAccessToken')
  const client = new messagingApi.MessagingApiClient({ channelAccessToken })
  return client.replyMessage({ replyToken, messages })
}

export const getProfile = async (thread_id: string, userId: string) => {
  const channelAccessToken = await getParameter('/vanilla/line/channelAccessToken')
  const client = new messagingApi.MessagingApiClient({ channelAccessToken })
  return client.getGroupMemberProfile(thread_id, userId)
}
