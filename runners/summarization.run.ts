import 'dotenv/config'
process.env.AWS_PROFILE = process.env.AWS_PROFILE || 'default'
process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-...'

import { v4 } from 'uuid'
import { type BaseMessage, HumanMessage } from '@langchain/core/messages'
import { summarizationGraph } from '../src/graphs/summarization'
import { storeMessage, clearMessages, clearCheckpoints } from '../src/services/dynamoDB'

const question = '總結一下對話紀錄。'
const chatHistory = `21:39 考量到花費好像很多人會選加拿大。加拿大去美國就業好像有相對應的條款（這個要查，我不確定）
21:39 美國看州，群長剛好也在美國 可以參考
21:40 如果他把學費攤進去的話有可能啊
21:42 我在紐約 自己是抓一年四百萬。美國非大城市不用到這麼貴，不過平均來說，美國比起其他國家應該是貴不少
21:44 薪水也高很多就是了，主要看看能不能順利在那邊找到工作
21:51 我會這麼強調就業問題是…我自己也在歐洲留學，現在有點不太確定這是否是對的了，所以才會希望你現在還有機會的時候可以往這方面多考慮，如果你真的對荷蘭留學很嚮往那就去吧，享受人生永遠是最重要的，剛剛那些話沒有要潑你冷水的意思🤠
21:51 歐洲sc目前有哪一國比較多缺嗎
21:57 因為預計是大四要去交換半年到一年，未來會回台灣讀研究所（沒意外的話），所以沒有想到工作那方面的事情，但真的很謝謝您！
21:57 精靈 這邊的資訊是指什麼呢？資訊人才嗎？
21:58 如果是交換那就好說了啊 選自己喜歡的🥳
22:02 交換的話選自己喜歡的就好～～ 我也是大學的時候到歐洲交換 之後回台灣念研究所 在歐洲的那一年真的是一輩子的回憶🥹
22:12 謝謝您！我會好好努力爭取交換的機會的(emoji)
22:29 我也是 大學去歐洲交換是一輩子的好回憶～
22:30 現在認真賺錢 然後排休請特休去歐洲玩🤣`

const thread_id = `test-thread-${v4()}`
const chat_mode = 'positive'
const model_name = 'gpt-4o-mini'

const run = async () => {
  const requests = chatHistory.split('\n').map((content) => storeMessage({ thread_id, content }))
  await Promise.all(requests)

  const { messages } = await summarizationGraph().invoke(
    { messages: [new HumanMessage(question)] },
    { configurable: { thread_id, question, chat_mode, model_name } }
  )

  await Promise.all([clearCheckpoints(thread_id), clearMessages(thread_id)])

  return (messages as BaseMessage[])
    .map((message) => {
      return `${message.getType()}: ${message.content.toString()}`
    })
    .join('\n')
}

;(async () => console.log(await run()))()
