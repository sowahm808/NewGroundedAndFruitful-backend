import {BusinessRuleError} from '../shared/errors.js';
export function validateFinalAssessment(ratings:readonly number[]):void {if(ratings.length!==5||ratings.some(r=>!Number.isInteger(r)||r<0||r>10))throw new BusinessRuleError('CHARACTER_ASSESSMENT_INCOMPLETE','Complete all five character reflections before submitting.');}
export function characterCompletionKey(participantId:string,assessmentId:string){return `CHARACTER:${participantId}:${assessmentId}`;}
