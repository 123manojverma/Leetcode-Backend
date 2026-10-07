import Redis from "ioredis";
import { serverConfig } from ".";
import logger from "./logger.config";

const redisConfig = {
    host: serverConfig.REDIS_HOST,
    port: serverConfig.REDIS_PORT,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => {
        if(times>3){
            return null;
        }
        return Math.min(times * 50, 3000); // 3 seconds
    }
}

const redis = new Redis(redisConfig);

redis.on("connect", () => {
    logger.info("Connected to redis successfully");
})

redis.on("error", (error) => {
    logger.error("Redis connection error", error);
})

export const createNewRedisConnection = () => {
    return new Redis(redisConfig);
}