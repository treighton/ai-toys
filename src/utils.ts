import process from "process"
import rdl from "readline"
import rdlP from "readline/promises"

export function formatConvHistory(messages: any[]) {
    return messages.map((message, i) => {
        if (i % 2 === 0){
            return `Human: ${message}`
        } else {
            return `AI: ${message}`
        }
    }).join('\n')
}

interface LoadingBar {
    size: number
    cursor: number
    timer: NodeJS.Timeout | null
}

class LoadingBar {
    constructor(size: number) {
        this.size = size
        this.cursor = 0
        this.timer = null
    }
    start() {
        process.stdout.write("\x1B[?25l")
        for (let i = 0; i < this.size; i++) {
            process.stdout.write("\u2591")
        }
        rdl.cursorTo(process.stdout, this.cursor, 0);
        this.timer = setInterval(() => {
            process.stdout.write("\u2588")
            this.cursor++;
            if (this.timer && (this.cursor >= this.size)) {
                clearTimeout(this.timer)
            }
        }, 100)
    }
}

const rl = rdlP.createInterface({
    input: process.stdin, 
    output: process.stdout,
})

export const ask = async (question: string) => {
    return await rl.question(question)
}

const test = async () => {
    const blank = '\n'.repeat(process.stdout.rows)
    console.log(blank)
    rdl.cursorTo(process.stdout, 0, 0)
    rdl.clearScreenDown(process.stdout)
    const answer = await ask('why?')
    console.log('\n')
    await rl.write('\n'+answer)
    console.log('\n')
    test()
} 

export {LoadingBar}