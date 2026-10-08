import { commands } from "./commands.util";
import { createNewDockerContainer } from "./createContainer.util";
export interface RunCodeOptions{
    code:string,
    language:"python"|"cpp",
    timeout:number,
    imageName:string,
    input:string
}

export async function runCode(options:RunCodeOptions) {
    // 1. Take the python code and dump in a file and run the python file in the container

    const {code,language,timeout,imageName,input}=options;

    const container = await createNewDockerContainer({
        imageName: imageName,
        cmdExecutable: commands[language](code,input),
        memoryLimit: 1024 * 1024 * 1024 // 1GB
    })

    let isTimeLimitExceed=false;

    const timeLimitExceedTimeout=setTimeout(async ()=>{
        console.log("Time limit exceeded");
        isTimeLimitExceed=true;
    },timeout);

    console.log("Container created successfully", container?.id);

    await container?.start();

    const status = await container?.wait();

    if(isTimeLimitExceed){
        // await container?.stop();
        await container?.remove();
        return{
            status:"time_limit_exceeded",
            output:"Time_Limit_Exceeded"
        }
    }

    const logs = await container?.logs({
        stdout: true,
        stderr: true
    })

    const containerLogs=processLogs(logs);

    await container?.remove();
    
    clearTimeout(timeLimitExceedTimeout);

    if(status.StatusCode==0){
        // success
        return{
            status:"success",
            output:containerLogs
        }
    }else{
        return {
            status:"failed",
            output:containerLogs
        }
    }
}

function processLogs(logs:Buffer | undefined){
    return logs?.toString('utf-8')
    .replace(/\x00/g,'') // Remove null bytes
    .replace(/\x1b\[[0-9;]*m/g,'') // Remove ANSI color codes
    .replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g,'') // Remove control characters except \n (0x0A)
    .trim();
}