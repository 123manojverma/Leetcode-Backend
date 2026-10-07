import { PYTHON_IMAGE } from "../constanats";
import { commands } from "./commands.util";
import { createNewDockerContainer } from "./createContainer.util";

export interface RunCodeOptions{
    code:string,
    language:"python"|"cpp",
    timeout:number
}

export async function runCode(options:RunCodeOptions) {
    // 1. Take the python code and dump in a file and run the python file in the container

    const {code,language,timeout}=options;

    const container = await createNewDockerContainer({
        imageName: PYTHON_IMAGE,
        cmdExecutable: commands[language](code),
        memoryLimit: 1024 * 1024 * 1024 // 1GB
    })

    const timeLimitExceedTimeout=setTimeout(()=>{
        console.log("Time limit exceeded");
        container?.kill();
    },timeout);

    console.log("Container created successfully", container?.id);

    await container?.start();

    const status = await container?.wait();

    console.log("Container status", status);

    const logs = await container?.logs({
        stdout: true,
        stderr: true
    })

    console.log("Container logs", logs?.toString());

    await container?.remove();
    
    clearTimeout(timeLimitExceedTimeout);

    if(status.StatusCode==0){
        // success
        console.log("Container exited successfully");
    }else{
        console.log("Container exited with error");
    }
}