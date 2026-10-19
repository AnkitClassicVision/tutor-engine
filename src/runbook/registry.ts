// Every AI step that runs through the runbook contract. The golden and lock tests walk this list.
import type { Contract } from "./contract.ts"
import { FRESH_PRACTICE } from "../fresh-practice.ts"
import { GRADE_RESPONSE, GROUND_JUDGMENT, VERIFY_JUDGMENT } from "../grade-response.ts"
import { PLAN_CURRICULUM } from "../plan-subject.ts"
import { LESSON_REPLY, PLAN_TALK } from "../talk.ts"
import { PARENT_PLANNER } from "../planner.ts"
import { GUIDE_HOMEWORK, READ_MATERIAL, REVIEW_HOMEWORK } from "../schoolwork.ts"
import { RESEARCH_SUBJECT } from "../subject-map.ts"

export const CONTRACTS: Contract<any, any>[] = [FRESH_PRACTICE, GRADE_RESPONSE, PLAN_CURRICULUM, PLAN_TALK, LESSON_REPLY, PARENT_PLANNER, READ_MATERIAL, REVIEW_HOMEWORK, GUIDE_HOMEWORK, RESEARCH_SUBJECT, VERIFY_JUDGMENT, GROUND_JUDGMENT]
