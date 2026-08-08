import {z} from 'zod';
export const idSchema=z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const programDateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const strictObject=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict();
