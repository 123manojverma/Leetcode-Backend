import axios from "axios";
import { serverConfig } from "../config";
import { InternalServerError } from "../utils/errors/app.error";
import logger from "../config/logger.config";

export async function updateSubmission(submissionId:string,status:string,output:Record<string,string>) {
    try{
        const url=`${serverConfig.SUBMISSION_SERVICE}/submissions/${submissionId}/status`;

        const response=await axios.patch(url,{
            status,
            submissionData:output
        })

        if(response.status!==200){
            throw new InternalServerError("Failed to update submission");
        }
        console.log("Submission updated successfully",response.data);
        return;

    }catch(error){
        logger.info(`Failed to update submission: ${error}`);
        return null;
    }
}