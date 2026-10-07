import { PYTHON_IMAGE } from "../constanats";
import { createNewDockerContainer } from "./createContainer.util";

export async function runPythonCode(code:string) {
    // 1. Take the python code and dump in a file and run the python file in the container

    const runCommand = `echo "${code}" > code.py && python3 code.py`;

    const container = await createNewDockerContainer({
        imageName: PYTHON_IMAGE,
        cmdExecutable: ['/bin/sh', '-c', runCommand],
        memoryLimit: 1024 * 1024 * 1024 // 1GB
    })

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
}