export const DEBUG_COMMANDS = `
commands:
  - name: configure
    parameters:
      - name: chat-mode
        alias: c
        default: normal
        options:
          - normal
          - positive
      - name: model
        alias: m
        default: gpt-4o-mini
        options:
          - gpt-3.5-turbo
          - gpt-4o
          - gpt-4o-mini
  - name: graph
    parameters:
      - name: expand
        alias: e
        default: 'false'
        options:
          - 'true'
          - 'false'
  - name: info
    parameters: ~
  - name: cleanup
    parameters: ~
  - name: refresh
    parameters: ~
`
