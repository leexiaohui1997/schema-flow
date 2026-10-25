-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "projectId" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "dbType" VARCHAR(32) NOT NULL,
    "dbConfig" JSONB NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" SERIAL NOT NULL,
    "projectId" VARCHAR(64) NOT NULL,
    "tableName" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "securityConfig" JSONB NOT NULL DEFAULT '{}',
    "viewConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fields" (
    "id" SERIAL NOT NULL,
    "tableId" INTEGER NOT NULL,
    "fieldKey" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(128) NOT NULL,
    "fieldType" VARCHAR(32) NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "primaryKeyStrategy" VARCHAR(32),
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "isReadonly" BOOLEAN NOT NULL DEFAULT false,
    "lengthLimit" INTEGER,
    "regex" VARCHAR(256),
    "defaultValue" VARCHAR(256),
    "options" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "extraConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_projectId_key" ON "projects"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "tables_projectId_tableName_key" ON "tables"("projectId", "tableName");

-- CreateIndex
CREATE UNIQUE INDEX "fields_tableId_fieldKey_key" ON "fields"("tableId", "fieldKey");

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
