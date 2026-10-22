'use strict';

import { GDB_EXPORT_FORMAT } from '../utils/vector-export/generate';
import { createVectorExportRequestsService } from '../utils/vector-export/service';

export default createVectorExportRequestsService('gdb.requests', GDB_EXPORT_FORMAT, {
  generate: 'generateAndSaveGdb',
  initiate: 'initiateGdbGenerate',
});
