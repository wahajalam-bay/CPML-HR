CREATE TYPE "public"."outcome" AS ENUM('In Process', 'Hired', 'Rejected', 'Withdrawn', 'Dropped Off', 'Lapsed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('Recruiter', 'Recruitment Manager', 'HR Director', 'Admin', 'Super Admin');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('applied', 'screened', 'phone_screen', 'assessment', 'sales_pitch', 'manager_interview', 'final_interview', 'offer', 'joined');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'suspended', 'locked');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "applications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_row_key" varchar(64) NOT NULL,
	"candidate_id" integer NOT NULL,
	"recruiter_id" integer,
	"source_id" integer,
	"role_id" integer,
	"hiring_manager_id" integer,
	"business_unit_id" integer,
	"applied_on" date NOT NULL,
	"stage_reached" "stage" NOT NULL,
	"stage_passed_mask" integer DEFAULT 0 NOT NULL,
	"outcome" "outcome" NOT NULL,
	"exit_stage" "stage",
	"call_on" date,
	"assessment_on" date,
	"sales_pitch_on" date,
	"manager_interview_on" date,
	"final_interview_on" date,
	"offer_on" date,
	"planned_start_on" date,
	"actual_start_on" date,
	"last_activity_on" date,
	"screen_status" varchar(40),
	"call_status" varchar(40),
	"assessment_status" varchar(40),
	"sales_pitch_status" varchar(40),
	"manager_status" varchar(40),
	"final_status" varchar(40),
	"offer_status" varchar(40),
	"final_disposition" varchar(60),
	"loss_category" varchar(40),
	"loss_reason" varchar(120),
	"loss_inferred" boolean DEFAULT false NOT NULL,
	"days_to_call" smallint,
	"days_call_to_assessment" smallint,
	"days_assessment_to_pitch" smallint,
	"days_pitch_to_manager" smallint,
	"days_manager_to_final" smallint,
	"days_final_to_offer" smallint,
	"days_offer_to_join" smallint,
	"time_to_offer" smallint,
	"time_to_hire" smallint,
	"start_date_slip" smallint,
	"days_idle" smallint,
	"application_seq" smallint DEFAULT 1 NOT NULL,
	"is_repeat" boolean DEFAULT false NOT NULL,
	"campaign" varchar(60),
	"remarks" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor_email" varchar(255),
	"actor_role" "role",
	"action" varchar(60) NOT NULL,
	"resource" varchar(200) NOT NULL,
	"scope" jsonb,
	"row_count" integer,
	"ip_address" varchar(64),
	"user_agent" text,
	"outcome" varchar(20) DEFAULT 'success' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_units" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_units_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(120) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "candidates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"phone" varchar(20),
	"full_name" varchar(160) NOT NULL,
	"email" varchar(255),
	"cnic" varchar(20),
	"city" varchar(80),
	"degree" varchar(40),
	"institute" varchar(160),
	"industry" varchar(80),
	"experience_years" real,
	"last_salary" integer
);
--> statement-breakpoint
CREATE TABLE "interviewers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "interviewers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(120) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalised" varchar(255) NOT NULL,
	"role" "role" DEFAULT 'Recruiter' NOT NULL,
	"recruiter_name" varchar(120),
	"token_hash" varchar(64) NOT NULL,
	"invited_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recruiters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recruiters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(120) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(120) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(80) NOT NULL,
	"channel" varchar(40),
	"monthly_cost" real
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_normalised" varchar(255) NOT NULL,
	"name" varchar(160) NOT NULL,
	"password_hash" text,
	"role" "role" DEFAULT 'Recruiter' NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"recruiter_name" varchar(120),
	"email_verified_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"failed_sign_ins" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_recruiter_id_recruiters_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."recruiters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_hiring_manager_id_interviewers_id_fk" FOREIGN KEY ("hiring_manager_id") REFERENCES "public"."interviewers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_applications_source_key" ON "applications" USING btree ("source_row_key");--> statement-breakpoint
CREATE INDEX "ix_app_date_recruiter" ON "applications" USING btree ("applied_on","recruiter_id");--> statement-breakpoint
CREATE INDEX "ix_app_date_source" ON "applications" USING btree ("applied_on","source_id");--> statement-breakpoint
CREATE INDEX "ix_app_date_role" ON "applications" USING btree ("applied_on","role_id");--> statement-breakpoint
CREATE INDEX "ix_app_date_outcome" ON "applications" USING btree ("applied_on","outcome");--> statement-breakpoint
CREATE INDEX "ix_app_stage_outcome" ON "applications" USING btree ("stage_reached","outcome");--> statement-breakpoint
CREATE INDEX "ix_app_candidate" ON "applications" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "ix_audit_occurred" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ix_audit_actor" ON "audit_log" USING btree ("actor_email");--> statement-breakpoint
CREATE INDEX "ix_audit_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_business_units_name" ON "business_units" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ix_candidates_phone" ON "candidates" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "ix_candidates_name" ON "candidates" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "ix_candidates_profile" ON "candidates" USING btree ("degree","industry");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_interviewers_name" ON "interviewers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invitations_token" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_invitations_email" ON "invitations" USING btree ("email_normalised");--> statement-breakpoint
CREATE INDEX "ix_rate_limits_window" ON "rate_limits" USING btree ("window_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_recruiters_name" ON "recruiters" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_roles_title" ON "roles" USING btree ("title");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_sessions_expiry" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sources_name" ON "sources" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_email_normalised" ON "users" USING btree ("email_normalised");--> statement-breakpoint
CREATE INDEX "ix_users_role" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "ix_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_tokens_hash" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_tokens_user_purpose" ON "verification_tokens" USING btree ("user_id","purpose");