import { Document, model, Schema } from "mongoose";

export enum SubmissionStatus {
    COMPLETED="completed",
    PENDING="pending"
}

export enum SubmissionLanguage {
    CPP = "cpp",
    PYTHON = "python"
}

export interface ISubmissionData{
    testCaseId:string;
    status:string;
}
export interface ISubmission extends Document {
    problemId: string;
    code: string;
    language: SubmissionLanguage;
    status: SubmissionStatus;
    submissionData:ISubmissionData;
    createdAt: Date;
    updatedAt: Date;
}

const submissionSchema = new Schema<ISubmission>({
    problemId: {
        type: String,
        required: [true, "Problem Id required for the submission"]
    },
    code: {
        type: String,
        required: [true, "Code is required for evaluation"]
    },
    language:{
        type:String,
        required:[true,"Language is required for evaluation"],
        enum:Object.values(SubmissionLanguage)
    },
    status:{
        type:String,
        required:true,
        default:SubmissionStatus.PENDING,
        enum:Object.values(SubmissionStatus)
    },
    submissionData:{
        type:Object,
        required:true,
        default:{}
    }
},{
    timestamps:true,
    toJSON:{
        transform:(_,record)=>{
            const {_id,__v,...problemRecord}=record;
            return {...problemRecord,id:String(_id)};
        }
    }
});

submissionSchema.index({status:1,createdAt:-1});

export const Submission=model<ISubmission>("Submission",submissionSchema);