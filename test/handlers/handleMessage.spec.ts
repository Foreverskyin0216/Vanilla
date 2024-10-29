import { type APIGatewayProxyEvent } from 'aws-lambda'
import { handler } from '../../src/handlers/handleMessage'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: mockSend })),
  PublishCommand: jest.fn((input) => input)
}))

describe('Spec: handleMessage handler', () => {
  describe('Given a message passed from the LineBot', () => {
    process.env.LINE_BOT_TOPIC = 'linebot-topic'
    const replyToken = 'replyToken'
    const body = JSON.stringify({
      events: [{ type: 'message', replyToken, message: { text: 'message', type: 'text' } }]
    })
    let response: { statusCode: number; body: string }

    beforeAll(async () => {
      response = await handler({ body } as APIGatewayProxyEvent)
    })

    it('should call SNS with the correct parameters', () => {
      expect(mockSend).toHaveBeenCalledWith({ TopicArn: 'linebot-topic', Message: body })
    })

    it('should return the correct response', () => {
      expect(response).toEqual({ statusCode: 200, body: JSON.stringify({ message: 'Received' }) })
    })
  })
})
