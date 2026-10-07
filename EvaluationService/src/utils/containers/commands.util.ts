const bashConfig=['/bin/sh', '-c'];

export const commands={
    python: function(code:string){
        const runCommand = `echo '${code}' > code.py && python3 code.py`;
        return [...bashConfig, runCommand];    
    },
    cpp: function(code:string){
        const runCommand = `echo '${code}' > code.cpp && g++ code.cpp -o code && ./code`;
        return [...bashConfig, runCommand];    
    }
}