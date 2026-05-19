const requestDocumentService = require('../src/services/request-service/services/requestDocument.service');

(async () => {
  try {
    const file = {
      buffer: Buffer.from('Test local document content'),
      mimetype: 'text/plain',
      originalname: 'test_local_doc.txt',
      size: 29
    };

    const requestId = 'f5be5782-fe8c-4eca-a096-7ee74fb1a74f';
    const companyId = 'c487e654-6827-4dc8-8690-baed056bcd5e';
    const uploadedBy = '400ec515-d926-4539-8848-3a87d37f38f6'; // Let's check a valid user ID or use any valid user

    console.log('Attempting local upload...');
    const result = await requestDocumentService.uploadDocument({
      file,
      requestId,
      companyId,
      uploadedBy,
      documentType: 'text'
    });

    console.log('Upload Result:', result);
    process.exit(0);
  } catch (error) {
    console.error('Error during upload test:', error);
    process.exit(1);
  }
})();
