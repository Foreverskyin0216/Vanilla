import { type DynamoDBClientConfig, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  BatchWriteCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb'

import { type LangGraphRunnableConfig as RunnableConfig } from '@langchain/langgraph'
import {
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
  BaseCheckpointSaver
} from '@langchain/langgraph-checkpoint'

export interface Message {
  thread_id: string
  created_at: number
  content: string
}

export interface Configuration {
  thread_id: string
  chat_mode: string
  model_name: string
}

/**
 * ### Implement a DynamoDB Saver as a LangGraph checkpointer.
 *
 * @class DynamoDBSaver
 * @extends {BaseCheckpointSaver} LangGraph base checkpointer.
 *
 * @param {Object} params - The parameters for the constructor.
 * @param {DynamoDBClientConfig} [params.dynamoDBClientConfig] - Optional configuration for the DynamoDB client.
 * @param {SerializerProtocol} [params.serde] - Optional serializer protocol for serializing and deserializing data.
 */
export class DynamoDBSaver extends BaseCheckpointSaver {
  client: DynamoDBDocumentClient
  checkpoint: string = 'Checkpoint'
  checkpointWrite: string = 'CheckpointWrite'
  separator: string = ':::'

  constructor(params: { clientConfig?: DynamoDBClientConfig; serde?: SerializerProtocol }) {
    super(params.serde)
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient(params.clientConfig))
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple> {
    const getItem = async ({ thread_id, checkpoint_id, checkpoint_ns }: typeof config.configurable) => {
      if (checkpoint_id) {
        const getCommand = new GetCommand({ TableName: this.checkpoint, Key: { thread_id, checkpoint_id } })
        const { Item } = await this.client.send(getCommand)
        return Item
      }

      const queryCommand = new QueryCommand({
        TableName: this.checkpoint,
        KeyConditionExpression: 'thread_id = :thread_id',
        ExpressionAttributeValues: {
          ':thread_id': thread_id,
          ...(checkpoint_ns && { ':checkpoint_ns': checkpoint_ns })
        },
        ...(checkpoint_ns && { FilterExpression: 'checkpoint_ns = :checkpoint_ns' }),
        Limit: 1,
        ScanIndexForward: false
      })

      const { Items } = await this.client.send(queryCommand)

      return Items?.[0]
    }

    const item = await getItem(config.configurable)
    if (!item) {
      return undefined
    }

    const checkpoint = await this.loadsTyped(item.type, item.checkpoint)
    const metadata = await this.loadsTyped(item.type, item.metadata)
    const checkpoint_write_id = [item.thread_id, item.checkpoint_id, item.checkpoint_ns].join(this.separator)

    const pendingWrites = []
    const queryCommand = new QueryCommand({
      TableName: this.checkpointWrite,
      KeyConditionExpression: 'thread_id_checkpoint_id_checkpoint_ns = :checkpoint_write_id',
      ExpressionAttributeValues: { ':checkpoint_write_id': checkpoint_write_id }
    })

    const { Items } = await this.client.send(queryCommand)

    for (const writeItem of Items ?? []) {
      const taskId = writeItem.task_index.split(this.separator)[0]
      const value = await this.loadsTyped(writeItem.type, writeItem.value)
      pendingWrites.push([taskId, writeItem.channel, value])
    }

    return {
      config: {
        configurable: {
          thread_id: item.thread_id,
          checkpoint_ns: item.checkpoint_ns,
          checkpoint_id: item.checkpoint_id
        }
      },
      checkpoint,
      metadata,
      parentConfig: item.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: item.thread_id,
              checkpoint_ns: item.checkpoint_ns,
              checkpoint_id: item.parent_checkpoint_id
            }
          }
        : undefined,
      pendingWrites
    }
  }

  async *list(config: RunnableConfig, options: { limit?: number; before?: RunnableConfig }) {
    const { limit, before } = options
    const thread_id = config.configurable?.thread_id

    const queryCommand = new QueryCommand({
      TableName: this.checkpoint,
      KeyConditionExpression:
        'thread_id = :thread_id' +
        (before?.configurable?.checkpoint_id ? ' AND checkpoint_id < :before_checkpoint_id' : ''),
      ExpressionAttributeValues: {
        ':thread_id': thread_id,
        ...(before?.configurable?.checkpoint_id && { ':before_checkpoint_id': before.configurable.checkpoint_id })
      },
      Limit: limit,
      ScanIndexForward: false
    })

    const { Items } = await this.client.send(queryCommand)

    for (const item of Items) {
      const checkpoint = await this.loadsTyped(item.type, item.checkpoint)
      const metadata = await this.loadsTyped(item.type, item.metadata)

      yield {
        config: {
          configurable: {
            thread_id: item.thread_id,
            checkpoint_ns: item.checkpoint_ns,
            checkpoint_id: item.checkpoint_id
          }
        },
        checkpoint,
        metadata,
        parentConfig: item.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: item.thread_id,
                checkpoint_ns: item.checkpoint_ns,
                checkpoint_id: item.parent_checkpoint_id
              }
            }
          : undefined
      }
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata | Uint8Array) {
    const { thread_id, checkpoint_ns } = config.configurable
    const [checkpointType, serializedCheckpoint] = this.dumpsTyped(checkpoint)
    const [metadataType, serializedMetadata] = this.dumpsTyped(metadata)

    if (checkpointType !== metadataType) {
      throw new Error('Failed to serialize checkpoint and metadata to the same type.')
    }

    const putCommand = new PutCommand({
      TableName: this.checkpoint,
      Item: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
        parent_checkpoint_id: config.configurable?.checkpoint_id,
        type: checkpointType,
        checkpoint: serializedCheckpoint,
        metadata: serializedMetadata
      }
    })

    await this.client.send(putCommand)

    return { configurable: { thread_id, checkpoint_ns, checkpoint_id: checkpoint.id } }
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string) {
    const { thread_id, checkpoint_ns, checkpoint_id } = config.configurable

    if (!checkpoint_id) {
      throw new Error('Missing checkpoint_id')
    }

    const pendingWriteItems = writes.map(([writeChannel, writeType], index) => {
      const [dumpedType, serializedValue] = this.dumpsTyped(writeType)
      return {
        PutRequest: {
          Item: {
            thread_id_checkpoint_id_checkpoint_ns: this.getWritePk(thread_id, checkpoint_id, checkpoint_ns),
            task_index: this.getWriteSk(taskId, index),
            channel: writeChannel,
            type: dumpedType,
            valu: serializedValue
          }
        }
      }
    })

    const batches = []
    for (let i = 0; i < pendingWriteItems.length; i += 25) {
      batches.push(pendingWriteItems.slice(i, i + 25))
    }

    const requests = batches.map((batch) => {
      const batchWriteCommand = new BatchWriteCommand({ RequestItems: { [this.checkpointWrite]: batch } })
      return this.client.send(batchWriteCommand)
    })

    await Promise.all(requests)
  }

  getWritePk(thread_id: string, checkpoint_id: string, checkpoint_ns: string) {
    return [thread_id, checkpoint_id, checkpoint_ns].join(this.separator)
  }

  getWriteSk(taskId: string, index: number) {
    return [taskId, index].join(this.separator)
  }

  dumpsTyped(data: unknown) {
    return this.serde.dumpsTyped(data)
  }

  loadsTyped(type: string, data: Uint8Array | string) {
    return this.serde.loadsTyped(type, data)
  }
}

/**
 * Get all messages in a chat group.
 *
 * @param {string} thread_id - The chat thread ID.
 */
export const getMessages = async (thread_id: string) => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }))
  const queryCommand = new QueryCommand({
    TableName: 'Message',
    KeyConditionExpression: '#thread_id = :thread_id',
    ExpressionAttributeNames: { '#thread_id': 'thread_id' },
    ExpressionAttributeValues: { ':thread_id': thread_id },
    ScanIndexForward: true
  })

  const { Items } = await client.send(queryCommand)

  return (Items ? Items : []) as Message[]
}

/**
 * Store a message to a chat group. The created_at field will be automatically generated.
 *
 * @param {Object} message - The message to store.
 * @param {string} [message.thread_id] - The chat group ID.
 * @param {string} [message.content] - The message content.
 */
export const storeMessage = async (message: Omit<Message, 'created_at'>) => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }))
  const putCommand = new PutCommand({ TableName: 'Message', Item: { ...message, created_at: Date.now() } })
  return client.send(putCommand)
}

/**
 * Clear all messages in a chat group.
 *
 * @param {string} thread_id - The group Id used to find all messages to delete.
 */
export const clearMessages = async (thread_id: string) => {
  const messages = await getMessages(thread_id)
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }))
  return Promise.all(
    messages.map(({ created_at }) => {
      const command = new DeleteCommand({ TableName: 'Message', Key: { thread_id, created_at } })
      const request = client.send(command)
      return request
    })
  )
}

/**
 * Get the configuration of a chat group.
 *
 * @param {string} thread_id - The chat group ID used to get the configuration.
 */
export const getConfiguration = async (thread_id: string) => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }))
  const queryCommand = new QueryCommand({
    TableName: 'ChatConfiguration',
    KeyConditionExpression: 'thread_id = :thread_id',
    ExpressionAttributeValues: { ':thread_id': thread_id }
  })

  const { Items } = await client.send(queryCommand)

  return Items?.length ? (Items[0] as Configuration) : undefined
}

/**
 * Set the configuration of a chat group.
 *
 * @param {Object} configuration - The configuration to set.
 * @param {string} configuration.thread_id - The chat group ID.
 * @param {string} configuration.chat_mode - The chat mode.
 * @param {string} configuration.model_name - The model name.
 */
export const setConfiguration = async (configuration: Configuration) => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }))
  const putCommand = new PutCommand({ TableName: 'ChatConfiguration', Item: configuration })
  return client.send(putCommand)
}

/**
 * Clear all checkpoints in a chat group.
 */
export const clearCheckpoints = async (thread_id: string) => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }))
  const queryCommand = new QueryCommand({
    TableName: 'Checkpoint',
    KeyConditionExpression: 'thread_id = :thread_id',
    ExpressionAttributeValues: { ':thread_id': thread_id }
  })
  const { Items } = await client.send(queryCommand)

  const requests = []

  for (const { checkpoint_id } of Items ?? []) {
    const deleteCommand = new DeleteCommand({ TableName: 'Checkpoint', Key: { thread_id, checkpoint_id } })
    const request = client.send(deleteCommand)
    requests.push(request)
  }

  const checkpoint_write_ids = (Items ?? []).map((item) =>
    [thread_id, item.checkpoint_id, item.checkpoint_ns].join(':::')
  )

  for (const checkpoint_write_id of Array.from(new Set(checkpoint_write_ids))) {
    const queryCommand = new QueryCommand({
      TableName: 'CheckpointWrite',
      KeyConditionExpression: 'thread_id_checkpoint_id_checkpoint_ns = :checkpoint_write_id',
      ExpressionAttributeValues: { ':checkpoint_write_id': checkpoint_write_id }
    })
    const { Items } = await client.send(queryCommand)

    for (const { task_index } of Items ?? []) {
      const command = new DeleteCommand({
        TableName: 'CheckpointWrite',
        Key: { thread_id_checkpoint_id_checkpoint_ns: checkpoint_write_id, task_index }
      })
      const request = client.send(command)
      requests.push(request)
    }
  }

  return Promise.all(requests)
}
