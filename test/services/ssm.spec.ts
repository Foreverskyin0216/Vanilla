import { v4 } from 'uuid'
import { when } from 'jest-when'

import { getParameter, setParameter } from '../../src/services/ssm'

const mockSend = jest.fn()

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSend })),
  GetParameterCommand: jest.fn((input) => input),
  PutParameterCommand: jest.fn((input) => input)
}))

describe('Spec: SSM Service', () => {
  describe('Given a parameter', () => {
    describe('When calling the getParameter function', () => {
      const parameter = 'test-parameter'
      const value = v4()
      const getParameterCommand = { Name: parameter, WithDecryption: true }
      let response: string

      describe('And the parameter does not exist', () => {
        beforeAll(async () => {
          when(mockSend).calledWith(getParameterCommand).mockRejectedValue({})
          response = await getParameter(parameter)
        })

        it('Then it should return an empty string', () => {
          expect(response).toBe('')
        })
      })

      describe('And the parameter exists', () => {
        beforeAll(async () => {
          when(mockSend)
            .calledWith(getParameterCommand)
            .mockResolvedValue({
              Parameter: { Value: value }
            })

          response = await getParameter(parameter)
        })

        it('Then it should return the correct parameter value', () => {
          expect(response).toBe(value)
        })

        it('Then it should call the GetParameterCommand with the correct input', () => {
          expect(mockSend).toHaveBeenCalledWith(getParameterCommand)
        })
      })
    })

    describe('When calling the setParameter function', () => {
      const parameter = 'test-parameter'
      const value = v4()
      const putParameterCommand = { Name: parameter, Value: value, Type: 'SecureString', Overwrite: true }

      beforeAll(async () => {
        when(mockSend).calledWith(putParameterCommand).mockResolvedValue({})
        await setParameter(parameter, value)
      })

      it('Then it should call the PutParameterCommand with the correct input', () => {
        expect(mockSend).toHaveBeenCalledWith(putParameterCommand)
      })
    })
  })
})
