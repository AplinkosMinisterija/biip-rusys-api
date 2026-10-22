'use strict';

import { GPKG_EXPORT_FORMAT } from '../utils/vector-export/generate';
import { createVectorExportRequestsService } from '../utils/vector-export/service';

export default createVectorExportRequestsService('gpkg.requests', GPKG_EXPORT_FORMAT, {
  generate: 'generateAndSaveGpkg',
  initiate: 'initiateGpkgGenerate',
});
