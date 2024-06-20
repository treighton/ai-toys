import 'dotenv/config'
import { OpenAIChat } from 'langchain/llms/openai'
import { ChatPromptTemplate, HumanMessagePromptTemplate, PromptTemplate, SystemMessagePromptTemplate } from "langchain/prompts"
import { StructuredOutputParser } from "langchain/output_parsers"
import { StringOutputParser } from 'langchain/schema/output_parser'
import inquirer from 'inquirer'
import { SupabaseVectorStore } from "langchain/vectorstores/supabase"
import { OpenAIEmbeddings } from "langchain/embeddings/openai"
import { Document } from 'langchain/document'
import { RunnablePassthrough, RunnableSequence } from "langchain/schema/runnable"

import { createClient } from '@supabase/supabase-js'
import { LoadingBar } from './utils.js'

const sbApiKey = process.env.SUPABASE_API_KEY || ""
const sbUrl = process.env.SUPABASE_URL || ""
const openAIApiKey = process.env.OPENAI_API_KEY || ""

const client = createClient(sbUrl, sbApiKey)

const formatConvHistory = (
    human: string,
    ai: string,
  ) => {
    const newInteraction = `Human: ${human}\nAI: ${ai}`;
    return newInteraction;
  };

const model = new OpenAIChat({ 
    modelName: "gpt-4",
    openAIApiKey: openAIApiKey, 
    temperature: 0.5
});

const embeddings = new OpenAIEmbeddings({ openAIApiKey })

const vectorStore = new SupabaseVectorStore(embeddings, {
    client,
    tableName: 'documents',
    queryName: 'match_documents'
})

const retriever = vectorStore.asRetriever()

const combineDocuments = (docs: Document[]) =>{
    return docs.map((doc)=>doc.pageContent).join('\n\n')
}

const saveMessages = async (user_id:string, messages: string[]) => {
    const history = formatConvHistory(messages[0], messages[1])
    try {
        await client
            .from('chat_history')
            .upsert({ chat_history: history, user_id: parseInt(user_id) })
            .select()
   } catch (err) {
       return console.log(err)
   }
}

const standaloneActionTemplate = 'Given a player input, convert it to a standalone action. action: {action} standalone input:'

const standaloneActionPrompt = PromptTemplate.fromTemplate(standaloneActionTemplate)

const gameMasterTemplate =  `You are an enthusiastic Game Master of the text based RPG adventure game Cthulhu Chronicles: Cosmic Conspiracy. Use the following context, campaign info and chat history respond to the player action. Always respond as if you are a narrator in a Lovecraftian horror story. If you don't know what to do just tell the player to try doing something else
----------------
CONTEXT: {context}
----------------
CAMPAIGN INFO: {campaignInfo}
----------------
CHAT HISTORY: {history}
----------------
ACTION: {action}

\n{format_instructions}. 
`

// Instantiate the parser
const parser = StructuredOutputParser.fromNamesAndDescriptions({
    context: "Information about the response that will provide context for the next prompt",
    response: "The NPC response based on the context and NPC personality to the players question, or the Game Keepers response to the player action.",
    next: "a question that will help guide the player to finding the first clue based on the NPC or Game Keeper response"
  });

const UserPrompt = `In this act, the players arrive in Arkham, encounter their first clues, and begin their investigation into the cosmic conspiracy.`


const answerPrompt = new ChatPromptTemplate({
    promptMessages: [
      SystemMessagePromptTemplate.fromTemplate(gameMasterTemplate),
      HumanMessagePromptTemplate.fromTemplate("{action}"),
    ],
    inputVariables: [
        "context",
        "action", 
        "campaignInfo",
        "history",
        "format_instructions"
    ],
  });
  


const standaloneActionChain = standaloneActionPrompt
    .pipe(model)
    .pipe(new StringOutputParser())
    
const retrieverChain = RunnableSequence.from([
    prevResult => prevResult.standalone_action,
    retriever,
    combineDocuments
])
const answerChain = answerPrompt
    .pipe(model)
    .pipe(parser)

const chain = RunnableSequence.from([
    {
        standalone_action: standaloneActionChain,
        original_input: new RunnablePassthrough()
    },
    {
        campaignInfo: retrieverChain,
        context:  ({ original_input }) => original_input.context,
        action: ({ original_input }) => original_input.action,
        history:  ({ original_input }) => original_input.history,
        format_instructions: ({ original_input }) => original_input.format_instructions
    },
    answerChain
])


const promptFunc = async (input: string, context:string, history?: string) => {

    const res = await chain.invoke({
        context,
        action: input,
        history: history || "",
        format_instructions: parser.getFormatInstructions(),
    });
    
    return res
};

const getChatHistory = async (user_id: string) => {
    const { data } = await client
                            .from('chat_history')
                            .select('chat_history')
                            .eq('user_id', user_id)

    return data?.map(({chat_history}) => `${chat_history}`).join('\n\n')
}

const gameLoop = async (context: string, question: string, user: string) => {

    const history = await getChatHistory(user)

    const resp = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: question,
        },
    ])

    if (resp.name === "quit") {
        return process.stdout.write('Thanks for playing')
    }

    try {
        const res = await promptFunc(resp.name, context, history)
        
        await saveMessages(user, ["Introduce the plays to the game, set the scene, and propose some actions the player can take", JSON.stringify(res)])
        
        process.stdout.write(res.response)
        
        gameLoop(res.context, res.next, user)
    } catch(err) {
        console.log(err)
    }
}

const init = async (context: string ) => {

    const playerInput = await inquirer.prompt([
        {
            type:'input',
            name: 'userId',
            message: 'What is your userId?'
        }
    ])

    const history = await getChatHistory(playerInput.userId)

    const prompt = history ? "Summarize my last play session, and pick up where we left off" : "Introduce the investigator to the game, set the scene, and propose some actions the player can take"

    try {

        const res = await promptFunc(prompt, context, history)
        
        await saveMessages(playerInput.userId, [prompt, JSON.stringify(res)])
        
        process.stdout.write(res.response)

        gameLoop(res.context, res.next, playerInput.userId)

    } catch(err) {
        console.log(err)
    }

};

init(UserPrompt)