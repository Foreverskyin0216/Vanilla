import { HumanMessage, AIMessage, RemoveMessage } from '@langchain/core/messages'
import { when } from 'jest-when'
import {
  shouldInvoke,
  searchNode,
  shouldUseSearchTools,
  chatNode,
  adjustmentNode,
  cleanupNode,
  chatGraph
} from '../../src/graphs/chat'

// Mock OpenAI
const mockParse = jest.fn()
jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({ beta: { chat: { completions: { parse: mockParse } } } }))
}))

// Mock LangChain
const mockInvoke = jest.fn()
const mockCompile = jest.fn()
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn(() => ({ bindTools: jest.fn().mockReturnThis(), invoke: mockInvoke }))
}))

jest.mock('@langchain/core/prompts', () => ({
  PromptTemplate: jest.fn(() => ({ pipe: jest.fn(() => ({ invoke: mockInvoke })) }))
}))

jest.mock('@langchain/langgraph', () => ({
  Annotation: jest.requireActual('@langchain/langgraph').Annotation,
  StateGraph: jest.fn(() => ({
    addEdge: jest.fn().mockReturnThis(),
    addNode: jest.fn().mockReturnThis(),
    addConditionalEdges: jest.fn().mockReturnThis(),
    compile: mockCompile
  })),
  messagesStateReducer: jest.fn()
}))

// Mock dependencies
jest.mock('../../src/tools/searchToolkit', () => ({ toolkit: [] }))
jest.mock('../../src/graphs/summarization', () => ({ summarizationGraph: jest.fn() }))

describe('Spec: Chat graph', () => {
  describe('When invoking the "shouldInvoke" conditional edge', () => {
    let response: string

    beforeAll(async () => {
      mockParse.mockResolvedValue({
        choices: [{ message: { parsed: { intent: 'chat' } } }]
      })
      response = await shouldInvoke({ messages: [], conversation: [] }, { configurable: {} })
    })

    it('should call OpenAI with the correct parameters', () => {
      expect(mockParse).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: expect.any(String) },
          { role: 'user', content: '' }
        ],
        response_format: expect.any(Object)
      })
    })

    it('should return the correct intent', () => {
      expect(response).toBe('chat')
    })
  })

  describe('When invoking the "searchNode" node', () => {
    let response: { messages: AIMessage[] }

    beforeAll(async () => {
      mockInvoke.mockResolvedValue(new AIMessage('response'))
      response = await searchNode({ messages: [], conversation: [] }, { configurable: {} })
    })

    it('should call ChatOpenAI with the correct parameters', () => {
      expect(mockInvoke).toHaveBeenCalledWith([new HumanMessage('')])
    })

    it('should return the correct response', () => {
      expect(response).toEqual({ messages: [new AIMessage('response')] })
    })
  })

  describe('When invoking the "shouldUseSearchTools" conditional edge', () => {
    const aiMessageWithTools = new AIMessage('response')
    aiMessageWithTools.tool_calls = [{ name: 'tool', args: [] }]
    const aiMessageWithoutTools = new AIMessage('response')
    let responseWithTools: string
    let responseWithoutTools: string

    beforeAll(() => {
      responseWithTools = shouldUseSearchTools({ messages: [aiMessageWithTools], conversation: [] })
      responseWithoutTools = shouldUseSearchTools({ messages: [aiMessageWithoutTools], conversation: [] })
    })

    it('should return the correct responses', () => {
      expect(responseWithTools).toBe('searchTools')
      expect(responseWithoutTools).toBe('adjustment')
    })
  })

  describe('When invoking the "chatNode" node', () => {
    const question = new HumanMessage('question')
    const normalResponse = new AIMessage('normal')
    normalResponse.additional_kwargs = { chatMode: 'normal' }
    const positiveResponse = new AIMessage('positive')
    positiveResponse.additional_kwargs = { chatMode: 'positive' }

    const normalMessages = [question, normalResponse]
    const normalContext = normalMessages.map(({ content }) => content).join('\n')

    const positiveMessages = [question, positiveResponse]
    const positiveContext = positiveMessages.map(({ content }) => content).join('\n')

    let normalNodeResponse: { messages: AIMessage[] }
    let positiveNodeResponse: { messages: AIMessage[] }

    beforeAll(async () => {
      when(mockInvoke)
        .calledWith({ question: '', context: normalContext })
        .mockResolvedValue(new AIMessage('normal response'))

      when(mockInvoke)
        .calledWith({ question: '', context: positiveContext })
        .mockResolvedValue(new AIMessage('positive response'))

      normalNodeResponse = await chatNode({ messages: [], conversation: normalMessages }, { configurable: {} })
      positiveNodeResponse = await chatNode(
        { messages: [], conversation: positiveMessages },
        { configurable: { chat_mode: 'positive' } }
      )
    })

    it('should call ChatOpenAI with the correct parameters', () => {
      expect(mockInvoke).toHaveBeenCalledWith({ question: '', context: normalContext })
      expect(mockInvoke).toHaveBeenCalledWith({ question: '', context: positiveContext })
    })

    it('should return the correct normal response', () => {
      expect(normalNodeResponse).toEqual({ messages: [new AIMessage('normal response')] })
    })

    it('should return the correct positive response', () => {
      expect(positiveNodeResponse).toEqual({ messages: [new AIMessage('positive response')] })
    })
  })

  describe('When invoking the "adjustmentNode" node', () => {
    const invokeResponse = new AIMessage('response')
    invokeResponse.additional_kwargs = { chatMode: 'normal' }
    const message = new AIMessage('message')
    let response: { conversation: AIMessage[] }

    beforeAll(async () => {
      mockInvoke.mockResolvedValue(invokeResponse)
      response = await adjustmentNode({ messages: [message], conversation: [] }, { configurable: {} })
    })

    it('should call ChatOpenAI with the correct parameters', () => {
      expect(mockInvoke).toHaveBeenCalledWith({ content: message.content })
    })

    it('should return the correct response', () => {
      expect(response).toEqual({ conversation: [invokeResponse] })
    })
  })

  describe('When invoking the "cleanupNode" node', () => {
    const messages = Array.from({ length: 30 }, (_, i) => new AIMessage(`message ${i}`))
    const conversation = Array.from({ length: 30 }, (_, i) => new AIMessage(`message ${i}`))

    let response: { messages: AIMessage[]; conversation: AIMessage[] }

    beforeAll(() => {
      response = cleanupNode({ messages, conversation })
    })

    it('should return the correct response', () => {
      expect(response).toEqual({
        messages: messages.map(({ id }) => new RemoveMessage({ id })),
        conversation: conversation.slice(0, -25).map(({ id }) => new RemoveMessage({ id }))
      })
    })
  })

  describe('When invoking the "chatGraph"', () => {
    beforeAll(() => {
      mockCompile.mockReturnValue('compiled')
      chatGraph()
    })

    it('should compile the graph', () => {
      expect(mockCompile).toHaveBeenCalled()
    })
  })
})
