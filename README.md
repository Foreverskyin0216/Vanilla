# Vanilla

<p>
  <img
    src="https://img.shields.io/badge/linejs-1.7.1-green"
  />
  <img
    src="https://img.shields.io/badge/langgraphjs-0.2.18-blue"
  />
  <img
    src="https://img.shields.io/badge/langchainjs-0.3.5-blue"
  />
</p>

## 📖 Description
Vanilla是一隻用於展示LineBot與LangGraph整合的可愛貓咪！

## 🚀 Usage

### Self Bot與Line Bot模式。
- Self Bot：開啟**Letter Sealing**功能後，將個人帳號加入社群，並將其取名為「香草」，之後要與她互動時，只需在社群中 `@香草` 即可。

- Line Bot：創建官方帳號並設定好Webhook URL，將其加入群組，之後要與她互動時，只需在群組中 `@香草` 即可。

### 環境設置

#### LINE Channel Access Token
Reference: [LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/getting-started/)

創建Line官方帳號，並取得Channel Access Token後，將Token加入環境變數中。

`export LINE_CHANNEL_ACCESS_TOKEN="..."`

#### LINE Email and Password
將個人Line帳號的Email和Password加入環境變數中。用於Self Bot模式的第一次登入，之後會將Auth Token與Refresh Token存入AWS Parameter Store，便不再需要Email和Password。

`export LINE_EMAIL="..." LINE_PASSWORD="..."`

#### OPENAI API Key
Reference: [OpenAI API Authentication](https://platform.openai.com/docs/api-reference/authentication)

`export OPENAI_API_KEY="..."`

#### AWS Profile
Reference: [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html)

由於此專案使用Serverless Framework部署，因此需要設定AWS Profile。

`export AWS_PROFILE="..."`

### 部署
Reference: [Deploy to AWS](https://www.serverless.com/framework/docs/providers/aws/guide/deploying)

`sls deploy`

## 📦 Features
- Chat：與Vanilla進行對話。
- Search：若Vanilla判斷你的問題需要進行搜尋，她會自動幫你搜尋。
- Summarize：可要求Vanilla幫你針對對話紀錄進行摘要。
- Debug：詳見 - [Debug 參數](https://github.com/Foreverskyin0216/Vanilla/blob/main/src/utils/commands.ts)

## 📚 Reference
- https://linejs.evex.land/
- https://langchain-ai.github.io/langgraphjs/
- https://js.langchain.com/docs/introduction/
