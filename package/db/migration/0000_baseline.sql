CREATE TYPE "public"."account_category" AS ENUM('nightlife', 'venue', 'promoter', 'artist', 'community', 'other');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('available', 'sold_out', 'waitlist', 'limited', 'early_bird');--> statement-breakpoint
CREATE TYPE "public"."event_category" AS ENUM('nightlife', 'music', 'arts', 'film', 'comedy', 'food', 'markets', 'sports', 'fitness', 'workshops', 'tech', 'community', 'art_culture', 'gaming', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('confirmed', 'rescheduled', 'cancelled', 'postponed', 'tentative');--> statement-breakpoint
CREATE TYPE "public"."location_status" AS ENUM('confirmed', 'tba', 'secret', 'dm_for_details');--> statement-breakpoint
CREATE TYPE "public"."review_tier" AS ENUM('ready', 'quick', 'full', 'rejected', 'pending');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"account_id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"username" varchar(50) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "account_email_unique" UNIQUE("email"),
	CONSTRAINT "account_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "account_preference" (
	"account_preference_id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"preferred_category" jsonb DEFAULT '[]'::jsonb,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "account_preference_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"event_id" serial PRIMARY KEY NOT NULL,
	"source_post_id" integer,
	"source_account_id" integer,
	"title" text NOT NULL,
	"event_date" date NOT NULL,
	"event_end_date" date,
	"event_time" text,
	"end_time" text,
	"description" text,
	"venue_id" integer,
	"venue_name" text,
	"venue_address" text,
	"venue_lat" real,
	"venue_lng" real,
	"location_status" "location_status" DEFAULT 'confirmed',
	"is_free" boolean DEFAULT true,
	"price" real,
	"price_min" real,
	"price_max" real,
	"price_note" text,
	"signup_url" text,
	"category" "event_category" DEFAULT 'other',
	"artists" jsonb DEFAULT '[]'::jsonb,
	"event_status" "event_status" DEFAULT 'confirmed',
	"availability_status" "availability_status" DEFAULT 'available',
	"is_recurring" boolean DEFAULT false,
	"recurrence_pattern" text,
	"completeness_score" real,
	"confidence" real,
	"review_tier" "review_tier" DEFAULT 'pending',
	"image_url" text,
	"source_username" text,
	"event_hash" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "event_event_hash_unique" UNIQUE("event_hash")
);
--> statement-breakpoint
CREATE TABLE "saved_event" (
	"saved_event_id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"saved_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_account" (
	"source_account_id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"full_name" text,
	"bio" text,
	"profile_pic_url" text,
	"follower_count" integer,
	"following_count" integer,
	"post_count" integer,
	"is_verified" boolean DEFAULT false,
	"is_business" boolean DEFAULT false,
	"category" "account_category" DEFAULT 'other',
	"venue_type" text,
	"category_distribution" jsonb,
	"is_active" boolean DEFAULT true,
	"last_scraped_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "source_account_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "source_post" (
	"source_post_id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"shortcode" text NOT NULL,
	"post_url" text NOT NULL,
	"post_type" text DEFAULT 'image',
	"caption" text,
	"posted_at" timestamptz,
	"image_url" text,
	"image_url_list" jsonb DEFAULT '[]'::jsonb,
	"like_count" integer DEFAULT 0,
	"comment_count" integer DEFAULT 0,
	"is_event" boolean DEFAULT false,
	"raw_extraction" jsonb,
	"extraction_method" text DEFAULT 'pending',
	"extraction_model" text,
	"prompt_version" text,
	"extracted_at" timestamptz,
	"ai_confidence" real,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "source_post_shortcode_unique" UNIQUE("shortcode")
);
--> statement-breakpoint
CREATE TABLE "sub_event" (
	"sub_event_id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"title" text NOT NULL,
	"event_date" date,
	"event_time" text,
	"end_time" text,
	"description" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"sync_log_id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamptz DEFAULT now() NOT NULL,
	"completed_at" timestamptz,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"account_synced_count" integer DEFAULT 0,
	"post_synced_count" integer DEFAULT 0,
	"event_synced_count" integer DEFAULT 0,
	"venue_synced_count" integer DEFAULT 0,
	"sub_event_synced_count" integer DEFAULT 0,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "venue" (
	"venue_id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"alias" jsonb DEFAULT '[]'::jsonb,
	"address" text,
	"city" text,
	"lat" real,
	"lng" real,
	"category" text,
	"instagram_handle" text,
	"geocode_attempted_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now(),
	CONSTRAINT "venue_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "account_preference" ADD CONSTRAINT "account_preference_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_source_post_id_source_post_source_post_id_fk" FOREIGN KEY ("source_post_id") REFERENCES "public"."source_post"("source_post_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_source_account_id_source_account_source_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_account"("source_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_venue_id_venue_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("venue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_event" ADD CONSTRAINT "saved_event_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_event" ADD CONSTRAINT "saved_event_event_id_event_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_post" ADD CONSTRAINT "source_post_account_id_source_account_source_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."source_account"("source_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_event" ADD CONSTRAINT "sub_event_event_id_event_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_account_email" ON "account" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_account_username" ON "account" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_event_date" ON "event" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "idx_event_category" ON "event" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_event_status" ON "event" USING btree ("event_status");--> statement-breakpoint
CREATE INDEX "idx_event_venue" ON "event" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "idx_event_hash" ON "event" USING btree ("event_hash");--> statement-breakpoint
CREATE INDEX "idx_event_account" ON "event" USING btree ("source_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_saved_event_unique" ON "saved_event" USING btree ("account_id","event_id");--> statement-breakpoint
CREATE INDEX "idx_saved_event_account" ON "saved_event" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_source_account_is_active" ON "source_account" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_source_post_account" ON "source_post" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_source_post_is_event" ON "source_post" USING btree ("is_event");--> statement-breakpoint
CREATE INDEX "idx_sub_event_event" ON "sub_event" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_venue_geocode_attempted_at" ON "venue" USING btree ("geocode_attempted_at");