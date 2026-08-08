import type {Firestore,Transaction} from 'firebase-admin/firestore';
import {FieldValue} from 'firebase-admin/firestore';
import type {AwardRequest,PointLedgerEntry} from './domain.js';
export class PointRepository {constructor(private readonly db:Firestore){}
 async award(input:AwardRequest,points:number):Promise<{entry:PointLedgerEntry;created:boolean}>{const ref=this.db.doc(`pointLedger/${input.idempotencyKey}`);return this.db.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists)return {entry:old.data() as PointLedgerEntry,created:false};const entry={...input,id:ref.id,points,createdAt:FieldValue.serverTimestamp()};tx.create(ref,entry);this.updateAggregates(tx,input,points);return {entry,created:true};});}
 private updateAggregates(tx:Transaction,input:AwardRequest,points:number):void{const inc=FieldValue.increment(points);tx.set(this.db.doc(`participantQuarterStats/${input.quarterId}_${input.participantId}`),{participantId:input.participantId,quarterId:input.quarterId,totalPoints:inc,updatedAt:FieldValue.serverTimestamp()},{merge:true});tx.set(this.db.doc(`teamQuarterStats/${input.quarterId}_${input.teamId}`),{teamId:input.teamId,quarterId:input.quarterId,totalPoints:inc,updatedAt:FieldValue.serverTimestamp()},{merge:true});}
}
