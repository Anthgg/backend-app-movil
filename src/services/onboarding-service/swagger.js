/**
 * @swagger
 * components:
 *   schemas:
 *     WorkerOnboardingRequest:
 *       type: object
 *       required: [personalData, laborData]
 *       properties:
 *         personalData:
 *           type: object
 *           required: [dni, firstName, paternalLastName]
 *           properties:
 *             dni: { type: string, example: "70000001" }
 *             firstName: { type: string, example: "Juan Carlos" }
 *             paternalLastName: { type: string, example: "Perez" }
 *             maternalLastName: { type: string, example: "Alvarez" }
 *             birthDate: { type: string, format: date }
 *             gender: { type: string, example: "male" }
 *             civilStatus: { type: string, example: "single" }
 *             nationality: { type: string, example: "Peruana" }
 *             phone: { type: string, example: "947399633" }
 *             personalEmail: { type: string, format: email }
 *             address: { type: string }
 *             emergencyContactName: { type: string }
 *             emergencyContactPhone: { type: string }
 *         laborData:
 *           type: object
 *           required: [companyId, areaId, positionId, startDate]
 *           properties:
 *             companyId: { type: string, format: uuid }
 *             branchId: { type: string, format: uuid }
 *             areaId: { type: string, format: uuid }
 *             positionId: { type: string, format: uuid }
 *             workerTypeId: { type: string, format: uuid }
 *             shiftId: { type: string, format: uuid }
 *             startDate: { type: string, format: date }
 *             supervisorId: { type: string, format: uuid }
 *             status: { type: string, example: "active" }
 *         contractData:
 *           type: object
 *           properties:
 *             generateContract: { type: boolean, example: true }
 *             requireGeneratedPdf: { type: boolean, example: false }
 *             contractType: { type: string, example: "temporal" }
 *             startDate: { type: string, format: date }
 *             endDate: { type: string, format: date }
 *             trialPeriod: { type: boolean }
 *             salary: { type: number, example: 1800 }
 *             currency: { type: string, example: "PEN" }
 *             workdayType: { type: string, example: "full_time" }
 *             workMode: { type: string, example: "onsite" }
 *             costCenterId: { type: string, format: uuid }
 *             observations: { type: string }
 *         accessData:
 *           type: object
 *           properties:
 *             createAccess: { type: boolean, example: true }
 *             role: { type: string, example: "TRABAJADOR" }
 *             username: { type: string, example: "juan.perez" }
 *             corporateEmail: { type: string, format: email, example: "juan.perez@fabryor.com" }
 *             temporaryPassword: { type: string, example: "Fabryor@2026" }
 *             forcePasswordChange: { type: boolean, example: true }
 *             sendCredentialsByEmail: { type: boolean, example: true }
 */
