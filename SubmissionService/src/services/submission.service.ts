import { getProblemById } from "../apis/problem.api";
import logger from "../config/logger.config";
import { ISubmission, SubmissionStatus } from "../models/submission.model";
import { addSubmissionJob } from "../producers/submission.producer";
import { ISubmissionRepository } from "../repositories/submission.repository";
import { BadRequestError, NotFoundError } from "../utils/errors/app.error";

export interface ISubmissionService {
    createSubmission(submissionData: Partial<ISubmission>): Promise<ISubmission>;
    getSubmissionById(id: string): Promise<ISubmission | null>;
    getSubmissionsByProblemId(problemId: string): Promise<ISubmission[]>;
    deleteSubmissionById(id: string): Promise<boolean>;
    updateSubmissionStatus(id: string, status: SubmissionStatus): Promise<ISubmission | null>;
}

export class SubmissionService implements ISubmissionService{

    private submissionRepository:ISubmissionRepository;

    constructor(submissionRepository:ISubmissionRepository){
        this.submissionRepository=submissionRepository;
    }

    async createSubmission(submissionData: Partial<ISubmission>): Promise<ISubmission> {
        // check if the problem exists
        if(!submissionData.problemId){
            throw new BadRequestError("Problem ID is required");
        }
        
        if(!submissionData.code){
            throw new BadRequestError("Code is required");
        }
        
        if(!submissionData.language){
            throw new BadRequestError("Language is required");
        }
        const problem=await getProblemById(submissionData.problemId);
        if(!problem){
            throw new NotFoundError("Problem not found or something went wrong");
        }

        // add the submission payload to the db
        const submission=await this.submissionRepository.create(submissionData);

        // submission to redis queue
        const jobId=await addSubmissionJob({
            submissionId: submission._id.toString(),
            problem,
            code:submissionData.code,
            language:submissionData.language
        })
        
        logger.info(`Submission job added: ${jobId}`)

        return submission;
    }

    async getSubmissionById(id: string): Promise<ISubmission | null> {
        const submission=await this.submissionRepository.findById(id);
        if(!submission){
            throw new NotFoundError("Submission not found");
        }
        return submission;
    }

    async getSubmissionsByProblemId(problemId: string): Promise<ISubmission[]> {
        const submission=await this.submissionRepository.findByProblemId(problemId);
        return submission;
    }

    async deleteSubmissionById(id: string): Promise<boolean> {
        return await this.submissionRepository.deleteById(id);
    }

    async updateSubmissionStatus(id: string, status: SubmissionStatus): Promise<ISubmission | null> {
        const submission=await this.submissionRepository.updateStatus(id,status);
        return submission;
    }
    
}