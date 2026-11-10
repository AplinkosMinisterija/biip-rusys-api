'use strict';

import { SHP_EXPORT_FORMAT } from '../utils/vector-export/generate';
import { createVectorExportRequestsService } from '../utils/vector-export/service';

export default createVectorExportRequestsService('shp.requests', SHP_EXPORT_FORMAT, {
  generate: 'generateAndSaveShp',
  initiate: 'initiateShpGenerate',
});
