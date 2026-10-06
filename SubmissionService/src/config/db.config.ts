import mongoose from "mongoose";
import logger from "./logger.config";
import { serverConfig } from ".";

export const connectDB=async()=>{
    try{
        const dbUrl=serverConfig.DB_URL;

        await mongoose.connect(dbUrl);

        logger.info("Connected to mongodb successfully");

        mongoose.connection.on("error",(error)=>{
            logger.error("MongoDB connection error",error);
        });

        mongoose.connection.on("disconnected",()=>{
            logger.warn("MongoDB disconnected");
        })

        process.on("SIGINT",async()=>{
            await mongoose.connection.close();
            logger.info("MongoDB connection closed");
            process.exit(0);
        })
    }catch(err){
        logger.error("Failed to connect to MongoDB",err);
        process.exit(1); // Exit with failure
    }
}