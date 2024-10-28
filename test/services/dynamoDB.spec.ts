import { type LangGraphRunnableConfig } from '@langchain/langgraph'
import {
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite
} from '@langchain/langgraph-checkpoint'
import { when } from 'jest-when'
import { v4 } from 'uuid'

import {
  type Message,
  type Configuration,
  DynamoDBSaver,
  getMessages,
  storeMessage,
  clearMessages,
  getConfiguration,
  setConfiguration,
  clearCheckpoints
} from '../../src/services/dynamoDB'

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

    describe('When calling the getTuple method', () => {
      const [thread_id, checkpoint_id, checkpoint_ns] = [v4(), v4(), v4()]
      const [checkpoint, metadata, value, channel, task_index] = [v4(), v4(), v4(), v4(), v4()]
      const checkpoint_write_id = [thread_id, checkpoint_id, checkpoint_ns].join(':::')
      const type = 'bytes'

      const getCommand = { TableName: 'Checkpoint', Key: { thread_id, checkpoint_id } }

      const checkpointQueryCommand = {
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

      const checkpointWriteQueryCommand = {
        TableName: 'CheckpointWrite',
        KeyConditionExpression: 'thread_id_checkpoint_id_checkpoint_ns = :checkpoint_write_id',
        ExpressionAttributeValues: { ':checkpoint_write_id': checkpoint_write_id }
      }

      let response: CheckpointTuple

      describe('And the checkpoint does not exist', () => {
        beforeAll(async () => {
          when(mockSend).calledWith(getCommand).mockResolvedValue({ Item: undefined })
          response = await dynamoDBSaver.getTuple({ configurable: { thread_id, checkpoint_id, checkpoint_ns } })
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return undefined', () => {
          expect(response).toBeUndefined()
        })

        it('Then it should call the GetCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(getCommand)
        })
      })

      describe('And calling with the checkpoint_id', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(getCommand)
            .mockResolvedValue({
              Item: {
                type,
                checkpoint,
                metadata,
                thread_id,
                checkpoint_id,
                checkpoint_ns,
                parent_checkpoint_id: checkpoint_id
              }
            })

          when(mockSend)
            .calledWith(checkpointWriteQueryCommand)
            .mockResolvedValue({ Items: [{ task_index, type, value, channel }] })

          response = await dynamoDBSaver.getTuple({ configurable: { thread_id, checkpoint_id, checkpoint_ns } })
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct CheckpointTuple', () => {
          const encoder = new TextEncoder()
          expect(response).toEqual({
            config: { configurable: { thread_id, checkpoint_id, checkpoint_ns } },
            pendingWrites: [[task_index.split(':::')[0], channel, encoder.encode(value)]],
            checkpoint: encoder.encode(checkpoint),
            metadata: encoder.encode(metadata),
            parentConfig: { configurable: { thread_id, checkpoint_ns, checkpoint_id } }
          })
        })

        it('Then it should call the GetCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(getCommand)
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(checkpointWriteQueryCommand)
        })
      })

      describe('And calling without the checkpoint_id', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(checkpointQueryCommand)
            .mockResolvedValue({ Items: [{ type, thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata }] })

          when(mockSend).calledWith(checkpointWriteQueryCommand).mockResolvedValue({})

          response = await dynamoDBSaver.getTuple({ configurable: { thread_id, checkpoint_ns } })
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct CheckpointTuple', () => {
          expect(response).toEqual({
            config: { configurable: { thread_id, checkpoint_id, checkpoint_ns } },
            pendingWrites: [],
            checkpoint: encoder.encode(checkpoint),
            metadata: encoder.encode(metadata),
            parentConfig: undefined
          })
        })

        it('Then it should call the Checkpoint QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(checkpointQueryCommand)
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(checkpointWriteQueryCommand)
        })
      })
    })

    describe('When calling the list method', () => {
      const [thread_id, checkpoint_id, checkpoint_ns, parent_checkpoint_id] = [v4(), v4(), v4(), v4()]
      const [checkpoint, metadata] = [v4(), v4()]
      const type = 'bytes'
      const limit = 1

      const queryWithoutCheckpointIdCommand = {
        TableName: 'Checkpoint',
        KeyConditionExpression: 'thread_id = :thread_id',
        ExpressionAttributeValues: { ':thread_id': thread_id },
        Limit: limit,
        ScanIndexForward: false
      }

      const queryWithCheckpointIdCommand = {
        TableName: 'Checkpoint',
        KeyConditionExpression: 'thread_id = :thread_id AND checkpoint_id < :before_checkpoint_id',
        ExpressionAttributeValues: { ':thread_id': thread_id, ':before_checkpoint_id': checkpoint_id },
        Limit: limit,
        ScanIndexForward: false
      }

      let response: AsyncGenerator

      describe('And calling without the checkpoint_id', () => {
        beforeAll(() => {
          when(mockSend)
            .calledWith(queryWithoutCheckpointIdCommand)
            .mockResolvedValue({
              Items: [{ thread_id, checkpoint_id, checkpoint_ns, type, checkpoint, metadata, parent_checkpoint_id }]
            })

          response = dynamoDBSaver.list({ configurable: { thread_id } }, { limit })
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct CheckpointTuple', async () => {
          expect((await response.next()).value).toEqual({
            config: { configurable: { thread_id, checkpoint_id, checkpoint_ns } },
            checkpoint: encoder.encode(checkpoint),
            metadata: encoder.encode(metadata),
            parentConfig: { configurable: { thread_id, checkpoint_ns, checkpoint_id: parent_checkpoint_id } }
          })
          expect((await response.next()).done).toBeTruthy()
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryWithoutCheckpointIdCommand)
        })
      })

      describe('And calling with the checkpoint_id', () => {
        beforeAll(() => {
          when(mockSend)
            .calledWith(queryWithCheckpointIdCommand)
            .mockResolvedValue({
              Items: [{ thread_id, checkpoint_id, checkpoint_ns, type, checkpoint, metadata, parent_checkpoint_id }]
            })

          response = dynamoDBSaver.list(
            { configurable: { thread_id } },
            { limit: 1, before: { configurable: { checkpoint_id } } }
          )
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct CheckpointTuple', async () => {
          expect((await response.next()).value).toEqual({
            config: { configurable: { thread_id, checkpoint_id, checkpoint_ns } },
            checkpoint: encoder.encode(checkpoint),
            metadata: encoder.encode(metadata),
            parentConfig: { configurable: { thread_id, checkpoint_ns, checkpoint_id: parent_checkpoint_id } }
          })
          expect((await response.next()).done).toBeTruthy()
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryWithCheckpointIdCommand)
        })
      })

      describe('And calling without the parent_checkpoint_id', () => {
        beforeAll(() => {
          when(mockSend)
            .calledWith(queryWithoutCheckpointIdCommand)
            .mockResolvedValue({ Items: [{ thread_id, checkpoint_id, checkpoint_ns, type, checkpoint, metadata }] })

          response = dynamoDBSaver.list({ configurable: { thread_id } }, { limit })
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct CheckpointTuple', async () => {
          expect((await response.next()).value).toEqual({
            config: { configurable: { thread_id, checkpoint_id, checkpoint_ns } },
            checkpoint: encoder.encode(checkpoint),
            metadata: encoder.encode(metadata),
            parentConfig: undefined
          })
          expect((await response.next()).done).toBeTruthy()
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryWithoutCheckpointIdCommand)
        })
      })
    })

    describe('When calling the put method', () => {
      const [thread_id, checkpoint_ns] = [v4(), v4(), v4()]
      const config = { configurable: { thread_id, checkpoint_ns } }
      const checkpoint: Checkpoint = {
        v: 1,
        id: v4(),
        ts: Date.now().toString(),
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
        pending_sends: []
      }
      const metadata: CheckpointMetadata = { source: 'input', step: 0, writes: {}, parents: {} }
      const [checkpointType, serializedCheckpoint] = dynamoDBSaver.dumpsTyped(checkpoint)
      const serializedMetadata = dynamoDBSaver.dumpsTyped(metadata)[1]

      const putCommand = {
        TableName: 'Checkpoint',
        Item: {
          thread_id,
          checkpoint_ns,
          checkpoint_id: checkpoint.id,
          parent_checkpoint_id: undefined,
          type: checkpointType,
          checkpoint: serializedCheckpoint,
          metadata: serializedMetadata
        }
      }

      let response: LangGraphRunnableConfig

      describe('And the checkpointType is not equal to the metadataType', () => {
        const unit8Metadata = new Uint8Array(Buffer.from('metadata'))

        afterAll(() => mockSend.mockClear())

        it('Then it should throw an error as expected', async () => {
          await expect(dynamoDBSaver.put(config, checkpoint, unit8Metadata)).rejects.toThrow(
            'Failed to serialize checkpoint and metadata to the same type.'
          )
        })
      })

      describe('And the checkpointType is equal to the metadataType', () => {
        beforeAll(async () => (response = await dynamoDBSaver.put(config, checkpoint, metadata)))

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct LangGraphRunnableConfig', async () => {
          expect(response).toEqual({
            configurable: { thread_id, checkpoint_ns, checkpoint_id: checkpoint.id }
          })
        })

        it('Then it should call the PutCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(putCommand)
        })
      })
    })

    describe('When calling the putWrites method', () => {
      const [thread_id, checkpoint_id, checkpoint_ns, channel, task_id] = [v4(), v4(), v4(), v4(), v4()]
      const writeValue = {
        v: 1,
        id: v4(),
        ts: Date.now().toString(),
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
        pending_sends: []
      }
      const pendingWrites = [[channel, writeValue]] as PendingWrite[]
      const [dumpedType, serializedValue] = dynamoDBSaver.dumpsTyped(writeValue)

      const batchWriteCommand = {
        RequestItems: {
          CheckpointWrite: [
            {
              PutRequest: {
                Item: {
                  thread_id_checkpoint_id_checkpoint_ns: `${thread_id}:::${checkpoint_id}:::${checkpoint_ns}`,
                  task_index: `${task_id}:::0`,
                  channel,
                  type: dumpedType,
                  valu: serializedValue
                }
              }
            }
          ]
        }
      }

      describe('And calling without the checkpoint_id', () => {
        const config = { configurable: { thread_id, checkpoint_ns } }

        afterAll(() => mockSend.mockClear())

        it('Then it should throw an error as expected', async () => {
          await expect(dynamoDBSaver.putWrites(config, pendingWrites, task_id)).rejects.toThrow('Missing checkpoint_id')
        })
      })

      describe('And calling with the checkpoint_id', () => {
        const config = { configurable: { thread_id, checkpoint_id, checkpoint_ns } }

        beforeAll(async () => {
          await dynamoDBSaver.putWrites(config, pendingWrites, task_id)
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should call the PutCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(batchWriteCommand)
        })
      })
    })
  })

  describe('Given a Message Table', () => {
    describe('When calling the getMessages method', () => {
      const thread_id = v4()
      const message = { thread_id, created_at: Date.now(), content: v4() }

      const queryCommand = {
        TableName: 'Message',
        KeyConditionExpression: '#thread_id = :thread_id',
        ExpressionAttributeNames: { '#thread_id': 'thread_id' },
        ExpressionAttributeValues: { ':thread_id': thread_id },
        ScanIndexForward: true
      }

      let response: Message[]

      describe('And the item does not exist', () => {
        beforeAll(async () => {
          when(mockSend).calledWith(queryCommand).mockResolvedValue({})
          response = await getMessages(thread_id)
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return an empty array', () => {
          expect(response).toEqual([])
        })
      })

      describe('And the item exists', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(queryCommand)
            .mockResolvedValue({ Items: [message] })

          response = await getMessages(thread_id)
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct array of messages', () => {
          expect(response).toEqual([message])
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryCommand)
        })
      })
    })

    describe('When calling the storeMessage method', () => {
      const message = { thread_id: v4(), content: v4() }

      beforeAll(async () => await storeMessage(message))

      afterAll(() => mockSend.mockClear())

      it('Then it should call the PutCommand method with the correct input', () => {
        expect(mockSend).toHaveBeenCalledWith({ TableName: 'Message', Item: expect.objectContaining(message) })
      })
    })

    describe('When calling the clearMessages method', () => {
      const thread_id = v4()
      const created_at = Date.now()

      const queryCommand = {
        TableName: 'Message',
        KeyConditionExpression: '#thread_id = :thread_id',
        ExpressionAttributeNames: { '#thread_id': 'thread_id' },
        ExpressionAttributeValues: { ':thread_id': thread_id },
        ScanIndexForward: true
      }

      const deleteCommand = { TableName: 'Message', Key: { thread_id, created_at } }

      beforeAll(async () => {
        when(mockSend)
          .calledWith(queryCommand)
          .mockResolvedValue({ Items: [{ thread_id, created_at }] })
        when(mockSend).calledWith(deleteCommand).mockResolvedValue({})
        await clearMessages(thread_id)
      })

      afterAll(() => mockSend.mockClear())

      it('Then it should call the DeleteCommand method with the correct input', () => {
        expect(mockSend).toHaveBeenCalledWith(deleteCommand)
      })
    })
  })

  describe('Given a ChatConfiguration Table', () => {
    describe('When calling the getConfiguration method', () => {
      const thread_id = v4()
      const configuration = { thread_id, chat_mode: 'normal', model_name: 'gpt-4o-mini' }

      const queryCommand = {
        TableName: 'ChatConfiguration',
        KeyConditionExpression: 'thread_id = :thread_id',
        ExpressionAttributeValues: { ':thread_id': thread_id }
      }

      let response: Configuration

      describe('And the configuration does not exist', () => {
        beforeAll(async () => {
          when(mockSend).calledWith(queryCommand).mockResolvedValue({})
          response = await getConfiguration(thread_id)
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return an empty object', () => {
          expect(response).toBeUndefined()
        })
      })

      describe('And the configuration exists', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(queryCommand)
            .mockResolvedValue({ Items: [configuration] })
          response = await getConfiguration(thread_id)
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct configuration', () => {
          expect(response).toEqual(configuration)
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(queryCommand)
        })
      })
    })

    describe('When calling the setConfiguration method', () => {
      const configuration = { thread_id: v4(), chat_mode: 'normal', model_name: 'gpt-4o-mini' }

      beforeAll(async () => await setConfiguration(configuration))

      afterAll(() => mockSend.mockClear())

      it('Then it should call the PutCommand method with the correct input', () => {
        expect(mockSend).toHaveBeenCalledWith({ TableName: 'ChatConfiguration', Item: configuration })
      })
    })
  })

  describe('Given a Checkpoint Table and a CheckpointWrite Table', () => {
    describe('When calling the clearCheckpoints method', () => {
      const thread_id = v4()
      const checkpoint_id = v4()
      const checkpoint_ns = v4()
      const task_index = `${v4()}:::0`
      const checkpoint_write_id = [thread_id, checkpoint_id, checkpoint_ns].join(':::')

      const checkpointQueryCommand = {
        TableName: 'Checkpoint',
        KeyConditionExpression: 'thread_id = :thread_id',
        ExpressionAttributeValues: { ':thread_id': thread_id }
      }
      const checkpointWriteQueryCommand = {
        TableName: 'CheckpointWrite',
        KeyConditionExpression: 'thread_id_checkpoint_id_checkpoint_ns = :checkpoint_write_id',
        ExpressionAttributeValues: { ':checkpoint_write_id': checkpoint_write_id }
      }

      const checkpointDeleteCommand = { TableName: 'Checkpoint', Key: { thread_id, checkpoint_id } }
      const checkpointWriteDeleteCommand = {
        TableName: 'CheckpointWrite',
        Key: { thread_id_checkpoint_id_checkpoint_ns: checkpoint_write_id, task_index }
      }

      let response = []

      describe('And the checkpoint does not exist', () => {
        beforeAll(async () => {
          when(mockSend).calledWith(checkpointQueryCommand).mockResolvedValue({})
          response = await clearCheckpoints(thread_id)
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return an empty array', () => {
          expect(response).toEqual([])
        })

        it('Then it should call the QueryCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(checkpointQueryCommand)
        })

        it('Then it should not call the CheckpointDeleteCommand method', () => {
          expect(mockSend).not.toHaveBeenCalledWith(checkpointDeleteCommand)
        })

        it('Then it should not call the CheckpointWriteCommands method', () => {
          expect(mockSend).not.toHaveBeenCalledWith(checkpointWriteQueryCommand)
          expect(mockSend).not.toHaveBeenCalledWith(checkpointWriteDeleteCommand)
        })
      })

      describe('And the checkpoint exists but the checkpointWrite does not exist', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(checkpointQueryCommand)
            .mockResolvedValue({ Items: [{ thread_id, checkpoint_id, checkpoint_ns }] })

          when(mockSend).calledWith(checkpointDeleteCommand).mockResolvedValue('Checkpoint deleted')
          when(mockSend).calledWith(checkpointWriteQueryCommand).mockResolvedValue({})

          response = await clearCheckpoints(thread_id)
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return an empty array', () => {
          expect(response).toEqual(['Checkpoint deleted'])
        })

        it('Then it should call the QueryCommands method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(checkpointQueryCommand)
          expect(mockSend).toHaveBeenCalledWith(checkpointWriteQueryCommand)
        })

        it('Then it should call the CheckpointDeleteCommand method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(checkpointDeleteCommand)
        })

        it('Then it should not call the CheckpointWriteDeleteCommand method', () => {
          expect(mockSend).not.toHaveBeenCalledWith(checkpointWriteDeleteCommand)
        })
      })

      describe('And the checkpoint exists', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(checkpointQueryCommand)
            .mockResolvedValue({ Items: [{ thread_id, checkpoint_id, checkpoint_ns }] })

          when(mockSend)
            .calledWith(checkpointWriteQueryCommand)
            .mockResolvedValue({
              Items: [
                {
                  thread_id_checkpoint_id_checkpoint_ns: checkpoint_write_id,
                  task_index
                }
              ]
            })
          when(mockSend).calledWith(checkpointDeleteCommand).mockResolvedValue('Checkpoint deleted')
          when(mockSend).calledWith(checkpointWriteDeleteCommand).mockResolvedValue('CheckpointWrite deleted')
          response = await clearCheckpoints(thread_id)
        })

        afterAll(() => mockSend.mockClear())

        it('Then it should return the correct response', () => {
          expect(response).toEqual(['Checkpoint deleted', 'CheckpointWrite deleted'])
        })

        it('Then it should call the QueryCommands method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(checkpointQueryCommand)
          expect(mockSend).toHaveBeenCalledWith(checkpointWriteQueryCommand)
        })

        it('Then it should call the DeleteCommands method with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(checkpointDeleteCommand)
          expect(mockSend).toHaveBeenCalledWith(checkpointWriteDeleteCommand)
        })
      })
    })
  })
})
