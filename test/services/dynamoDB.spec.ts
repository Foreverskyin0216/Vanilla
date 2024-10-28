import { type CheckpointTuple } from '@langchain/langgraph-checkpoint'
import { when } from 'jest-when'
import { v4 } from 'uuid'
import { DynamoDBSaver } from '../../src/services/dynamoDB'
const mockSend = jest.fn()

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((input) => input),
  QueryCommand: jest.fn((input) => input),
  PutCommand: jest.fn((input) => input),
  BatchWriteCommand: jest.fn((input) => input),
  DeleteCommand: jest.fn((input) => input)
}))

describe('Spec: DynamoDB Service', () => {
  describe('Given a DynamoDB Saver', () => {
    const dynamoDBSaver = new DynamoDBSaver({})
    const encoder = new TextEncoder()

    describe('When calling the getTuple method with the checkpoint_id', () => {
      const [thread_id, checkpoint_id, checkpoint_ns] = [v4(), v4(), v4()]
      const [checkpoint, metadata, value, channel, task_index] = [v4(), v4(), v4(), v4(), v4()]
      const checkpoint_write_id = [thread_id, checkpoint_id, checkpoint_ns].join(':::')
      const getCommand = {
        TableName: 'Checkpoint',
        Key: { thread_id, checkpoint_id }
      }

      const queryCommand = {
        TableName: 'CheckpointWrite',
        KeyConditionExpression: 'thread_id_checkpoint_id_checkpoint_ns = :checkpoint_write_id',
        ExpressionAttributeValues: { ':checkpoint_write_id': checkpoint_write_id }
      }

      let response: CheckpointTuple

      describe('And the item does not exist', () => {
        beforeAll(async () => {
          when(mockSend).calledWith(getCommand).mockResolvedValue({ Item: undefined })

          response = await dynamoDBSaver.getTuple({ configurable: { thread_id, checkpoint_id, checkpoint_ns } })
        })

        it('Then it should return undefined', () => {
          expect(response).toBeUndefined()
        })

        it('Then it should call the GetCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(getCommand)
        })
      })

      describe('And the item exists', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(getCommand)
            .mockResolvedValue({
              Item: { type: 'bytes', checkpoint, metadata, thread_id, checkpoint_id, checkpoint_ns }
            })

          when(mockSend)
            .calledWith(queryCommand)
            .mockResolvedValue({ Items: [{ task_index, type: 'bytes', value, channel }] })

          response = await dynamoDBSaver.getTuple({ configurable: { thread_id, checkpoint_id, checkpoint_ns } })
        })

        it('Then it should return the correct CheckpointTuple', () => {
          const encoder = new TextEncoder()
          expect(response).toEqual({
            config: { configurable: { thread_id, checkpoint_id, checkpoint_ns } },
            pendingWrites: [[task_index.split(':::')[0], channel, encoder.encode(value)]],
            checkpoint: encoder.encode(checkpoint),
            metadata: encoder.encode(metadata),
            parentConfig: undefined
          })
        })

        it('Then it should call the GetCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(getCommand)
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryCommand)
        })
      })
    })

    describe('When calling the getTuple method without the checkpoint_id', () => {
      const [thread_id, checkpoint_id, checkpoint_ns] = [v4(), v4(), v4()]
      const [checkpoint, metadata, value, channel, task_index] = [v4(), v4(), v4(), v4(), v4()]
      const checkpoint_write_id = [thread_id, checkpoint_id, checkpoint_ns].join(':::')
      const queryCommand1 = {
        TableName: 'Checkpoint',
        KeyConditionExpression: 'thread_id = :thread_id',
        ExpressionAttributeValues: {
          ':thread_id': thread_id,
          ...(checkpoint_ns && { ':checkpoint_ns': checkpoint_ns })
        },
        ...(checkpoint_ns && { FilterExpression: 'checkpoint_ns = :checkpoint_ns' }),
        Limit: 1,
        ScanIndexForward: false
      }

      const queryCommand2 = {
        TableName: 'CheckpointWrite',
        KeyConditionExpression: 'thread_id_checkpoint_id_checkpoint_ns = :checkpoint_write_id',
        ExpressionAttributeValues: { ':checkpoint_write_id': checkpoint_write_id }
      }

      let response: CheckpointTuple

      describe('And the item does not exist', () => {
        beforeAll(async () => {
          when(mockSend).calledWith(queryCommand1).mockResolvedValue({ Items: undefined })

          response = await dynamoDBSaver.getTuple({ configurable: { thread_id, checkpoint_ns } })
        })

        it('Then it should return undefined', () => {
          expect(response).toBeUndefined()
        })

        it('Then it should call the GetCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryCommand1)
        })
      })

      describe('And the item exists', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(queryCommand1)
            .mockResolvedValue({
              Items: [{ type: 'bytes', checkpoint, metadata, thread_id, checkpoint_id, checkpoint_ns }]
            })

          when(mockSend)
            .calledWith(queryCommand2)
            .mockResolvedValue({ Items: [{ task_index, type: 'bytes', value, channel }] })

          response = await dynamoDBSaver.getTuple({ configurable: { thread_id, checkpoint_ns } })
        })

        it('Then it should return the correct CheckpointTuple', () => {
          expect(response).toEqual({
            config: { configurable: { thread_id, checkpoint_id, checkpoint_ns } },
            pendingWrites: [[task_index.split(':::')[0], channel, encoder.encode(value)]],
            checkpoint: encoder.encode(checkpoint),
            metadata: encoder.encode(metadata),
            parentConfig: undefined
          })
        })

        it('Then it should call the GetCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryCommand1)
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryCommand2)
        })
      })
    })
  })
})
