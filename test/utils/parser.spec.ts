import { parseDebugCommand } from '../../src/utils/parser'

describe('Spec: parser utils', () => {
  describe('When calling the parseDebugCommand function', () => {
    describe('And the command is without any params', () => {
      it('Then it should return the correct parsed result', () => {
        expect(parseDebugCommand('debug info')).toEqual({ command: 'info' })
      })
    })

    describe('And the command is with alias params', () => {
      it('Then it should return the correct parsed result', () => {
        expect(parseDebugCommand('debug graph -e true')).toEqual({
          command: 'graph',
          params: { expand: 'true' }
        })
      })
    })

    describe('And the command is with options params', () => {
      it('Then it should return the correct parsed result', () => {
        expect(parseDebugCommand('debug configure -c positive --model invalidModel')).toEqual({
          command: 'configure',
          params: { 'chat-mode': 'positive', model: 'gpt-4o-mini' }
        })
      })
    })

    describe('And the command is invalid', () => {
      expect(parseDebugCommand('debug invalid')).toEqual({ error: 'Invalid command format' })
    })
  })
})
