import { type APIGatewayProxyEvent } from 'aws-lambda'
import { publishMessage } from '../services/sns'

export const handler = async (event: APIGatewayProxyEvent) => {
  console.log('Received event:', JSON.stringify(event, null, 2))
  console.log('Topic:', process.env.LINE_BOT_TOPIC)
  const result = await publishMessage(process.env.LINE_BOT_TOPIC, event.body)
  console.log('Published message:', JSON.stringify(result, null, 2))
  return { statusCode: 200, body: JSON.stringify({ message: 'Received' }) }
}
