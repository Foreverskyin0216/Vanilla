import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'

export const publishMessage = async (topicArn: string, message: string) => {
  const client = new SNSClient({ region: process.env.AWS_REGION })
  const command = new PublishCommand({ TopicArn: topicArn, Message: message })
  return client.send(command)
}
