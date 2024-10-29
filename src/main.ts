import 'dotenv/config'
process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2'
import { SelfBot } from './handlers/selfBot'
import { logger } from './utils/logger'

// Workaround for https://github.com/evex-dev/linejs/issues/45
process.on('uncaughtException', (error) => {
  if (error.name === 'InputBufferUnderrunError') {
    logger.error('InputBufferUnderrunError')
  } else {
    throw error
  }
})
;(async () => await new SelfBot().login())()
