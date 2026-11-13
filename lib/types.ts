import type { ObjectId } from "mongodb";

export type UserRole = "admin" | "coach" | "player" | "scout";
export type AttendanceStatus = "present" | "absent";
export type SessionStatus = "open" | "closed";

export interface OrganizationDocument {
  _id: ObjectId;
  name: string;
  slug: string;
  type: "academy" | "school" | "college";
  city?: string;
  timezone: string;
  createdAt: Date;
}

export interface UserDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  athleteId?: ObjectId;
  active: boolean;
  createdAt: Date;
}

export interface AthleteDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  teamId: ObjectId;
  userId?: ObjectId;
  name: string;
  age?: number;
  studentId: string;
  sport: string;
  teamName: string;
  year: string;
  joinedAt: string;
  active: boolean;
  createdAt: Date;
}

export interface TeamDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  name: string;
  sport: string;
  coachIds: ObjectId[];
  createdAt: Date;
}

export interface SessionDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  teamId: ObjectId;
  teamName: string;
  sport: string;
  title: string;
  date: string;
  startTime: string;
  status: SessionStatus;
  createdBy: ObjectId;
  createdAt: Date;
  closedAt?: Date;
  closedBy?: ObjectId;
}

export interface AttendanceDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  sessionId: ObjectId;
  athleteId: ObjectId;
  status: AttendanceStatus;
  recordedBy: ObjectId;
  updatedAt: Date;
}

export interface MatchDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  sessionId: ObjectId;
  teamId: ObjectId;
  teamName: string;
  sport: string;
  opponent: string;
  date: string;
  startTime: string;
  createdBy: ObjectId;
  createdAt: Date;
}

export interface MatchScoreDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  matchId: ObjectId;
  athleteId: ObjectId;
  score: number;
  recordedBy: ObjectId;
  updatedAt: Date;
}

export interface AuthUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: UserRole;
  athleteId?: string;
}
