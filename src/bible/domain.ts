export type BibleActivityType='multiple_choice'|'true_false'|'scripture'|'reflection'|'memory_verse';
export const bibleCompletionKey=(participantId:string,responseId:string)=>`BIBLE:${participantId}:${responseId}`;
