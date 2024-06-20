import 'dotenv/config'
import { readFile } from "node:fs/promises"
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { createClient } from '@supabase/supabase-js'
import { SupabaseVectorStore } from 'langchain/vectorstores/supabase'

const path = process.env.args &&  process.env.args[2] || ""

async function loadDocs(path: string) {
  // @supabase/supabase-js
  try {
      const result = (await readFile(path)).toString()
      const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 500,
          chunkOverlap: 50,
          separators: ['\n\n', '\n', ' ', ''] // default setting
      })
      
      const output = await splitter.createDocuments([result])
      
      const sbApiKey = process.env.SUPABASE_API_KEY || ""
      const sbUrl = process.env.SUPABASE_URL || ""
      const openAIApiKey = process.env.OPENAI_API_KEY || ""
      
      const client = createClient(sbUrl, sbApiKey)
      
      await SupabaseVectorStore.fromDocuments(
          output,
          new OpenAIEmbeddings({ openAIApiKey }),
          {
             client,
             tableName: 'documents',
          }
      )
      
  } catch (err) {
      console.log(err)
  }
}

if (path) {
  loadDocs(path)
} else {
  console.log('tell me what to load...')
}