CREATE TABLE "khal"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monthly_value_cents" integer NOT NULL,
	"data_allowance_gb" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "khal"."customers" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "khal"."customers" ADD COLUMN "cep" text;--> statement-breakpoint
ALTER TABLE "khal"."customers" ADD COLUMN "numero" text;--> statement-breakpoint
ALTER TABLE "khal"."customers" ADD COLUMN "complemento" text;--> statement-breakpoint
ALTER TABLE "khal"."customers" ADD CONSTRAINT "customers_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "khal"."plans"("id") ON DELETE set null ON UPDATE no action;