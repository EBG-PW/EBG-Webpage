-- Enable the uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "puuid" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "username" TEXT,
    "email" TEXT,
    "email_verified" TIMESTAMPTZ(6),
    "password" TEXT,
    "user_group" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "bio" TEXT,
    "avatar_url" TEXT,
    "public" BOOLEAN DEFAULT false,
    "legal" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "twofa_secret" TEXT,
    "twofa_time" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "twofa_token" TEXT,
    "time" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users_settings" (
    "user_id" INTEGER NOT NULL,
    "design" TEXT,
    "language" TEXT,

    CONSTRAINT "users_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "users_addresses" (
    "user_id" INTEGER NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "country" TEXT,

    CONSTRAINT "users_addresses_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "users_accounts" (
    "user_id" INTEGER NOT NULL,
    "app" TEXT NOT NULL,
    "account_id" TEXT,
    "profile_url" TEXT,

    CONSTRAINT "users_accounts_pkey" PRIMARY KEY ("user_id","app")
);

-- CreateTable
CREATE TABLE "users_permissions" (
    "user_id" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,
    "read" BOOLEAN,
    "write" BOOLEAN,
    "time" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_permissions_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateTable
CREATE TABLE "users_links" (
    "user_id" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "data_val" TEXT NOT NULL,

    CONSTRAINT "users_links_pkey" PRIMARY KEY ("user_id","platform")
);

-- CreateTable
CREATE TABLE "users_integrations" (
    "user_id" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "unique_remote_id" TEXT NOT NULL,

    CONSTRAINT "users_integrations_pkey" PRIMARY KEY ("user_id","platform")
);

-- CreateTable
CREATE TABLE "projectactivities" (
    "id" SERIAL NOT NULL,
    "puuid" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "type" SMALLINT,
    "name" TEXT,
    "description" TEXT,
    "avatar_url" TEXT,
    "color" TEXT,
    "location_address" TEXT,
    "date_start" TIMESTAMPTZ(6),
    "date_end" TIMESTAMPTZ(6),
    "date_created" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "date_apply" TIMESTAMPTZ(6),
    "min_group" TEXT,
    "visibility" SMALLINT,
    "state" SMALLINT,
    "creator_user_id" INTEGER,

    CONSTRAINT "projectactivities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projectactivity_users" (
    "activity_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "activity_group" TEXT,
    "notification" BOOLEAN DEFAULT true,
    "has_logged_in" BOOLEAN DEFAULT false,
    "time" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projectactivity_users_pkey" PRIMARY KEY ("activity_id","user_id")
);

-- CreateTable
CREATE TABLE "projectactivity_timeline" (
    "activity_id" INTEGER NOT NULL,
    "content" TEXT,
    "time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projectactivity_timeline_pkey" PRIMARY KEY ("activity_id","time")
);

-- CreateTable
CREATE TABLE "oauth_apps" (
    "id" BIGINT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "scope" BIGINT,
    "client_id" TEXT,
    "secret" TEXT,
    "redirect_url" TEXT,
    "time" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "user_id" BIGINT NOT NULL,
    "app_id" BIGINT NOT NULL,
    "access_token" TEXT,
    "time_access_token" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "refresh_token" TEXT,
    "time_refresh_token" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("user_id","app_id")
);

-- CreateTable
CREATE TABLE "webtokens" (
    "user_id" INTEGER,
    "token" TEXT NOT NULL,
    "browser" TEXT,
    "time" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webtokens_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "confirmation_tokens" (
    "user_id" INTEGER,
    "type" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "data" TEXT,
    "time" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confirmation_tokens_pkey" PRIMARY KEY ("type","token")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_puuid_key" ON "users"("puuid");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "projectactivities_puuid_key" ON "projectactivities"("puuid");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_apps_client_id_key" ON "oauth_apps"("client_id");

-- CreateIndex
CREATE INDEX "idx_oauth_client_id" ON "oauth_apps"("client_id");

-- AddForeignKey
ALTER TABLE "projectactivity_users" ADD CONSTRAINT "projectactivity_users_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "projectactivities"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "projectactivity_timeline" ADD CONSTRAINT "projectactivity_timeline_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "projectactivities"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "oauth_apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
