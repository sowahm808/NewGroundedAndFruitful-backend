import {BusinessRuleError} from '../shared/errors.js';
export const projectStates=['idea','goal','mentor_guidance','plan','action','progress','reflection','completed'] as const;export type ProjectState=typeof projectStates[number];
const transitions:Record<ProjectState,readonly ProjectState[]>={idea:['goal'],goal:['mentor_guidance'],mentor_guidance:['plan'],plan:['action'],action:['progress'],progress:['progress','reflection'],reflection:['completed'],completed:[]};
export function assertProjectTransition(from:ProjectState,to:ProjectState):void{if(!transitions[from].includes(to))throw new BusinessRuleError('INVALID_PROJECT_TRANSITION',`Cannot transition project from ${from} to ${to}.`);}
