import {applicationDefault,getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
const app=getApps()[0]??initializeApp({credential:applicationDefault()});
export const db=getFirestore(app);
export const auth=getAuth(app);
