import { ServerClient } from 'postmark';
import { FormStatus } from '../services/forms.service';
import { RequestStatus, RequestType } from '../services/requests.service';
import { Taxonomy } from '../services/taxonomies.service';
import { TaxonomySpeciesType } from '../services/taxonomies.species.service';
const client = new ServerClient(process.env.POSTMARK_KEY);

const sender = 'noreply@biip.lt';

export function emailCanBeSent() {
  return true;

  return ['production'].includes(process.env.NODE_ENV);
}

function hostUrl(isAdmin: boolean = false) {
  return isAdmin ? process.env.ADMIN_HOST : process.env.APP_HOST;
}

function getSystemName(speciesType: string) {
  return speciesType === TaxonomySpeciesType.ENDANGERED ? 'SRIS' : 'INVA';
}

export function notifyFormAssignee(email: string, formId: number | string, species: Taxonomy) {
  return client.sendEmailWithTemplate({
    From: sender,
    To: email.toLowerCase(),
    TemplateId: 41565552,
    TemplateModel: {
      species: species.speciesName,
      speciesLatin: species.speciesNameLatin,
      actionUrl: `${hostUrl()}/rusys/stebejimo-anketos/${formId}`,
      systemName: getSystemName(species.speciesType),
    },
  });
}

export function notifyOnFormUpdate(
  email: string,
  type: string,
  formId: number | string,
  taxonomy: Taxonomy,
  isExpert: boolean = false,
  isAdmin: boolean = false,
  expertComment?: string,
) {
  const updateTypes: any = {
    [FormStatus.APPROVED]: 'Patvirtinta',
    [FormStatus.REJECTED]: 'Atmesta',
    [FormStatus.SUBMITTED]: 'Pateikta pakartotinai',
    [FormStatus.RETURNED]: 'Grąžinta taisymui',
  };
  const updateType = updateTypes[type] || '';

  if (!updateType) return;

  const path = isExpert || isAdmin ? 'rusys/stebejimo-anketos' : 'stebejimo-anketos';

  return client.sendEmailWithTemplate({
    From: sender,
    To: email.toLowerCase(),
    TemplateId: 41565507,
    TemplateModel: {
      title: updateType,
      titleText: updateType.toLowerCase(),
      species: taxonomy.speciesName,
      speciesLatin: taxonomy.speciesNameLatin,
      actionUrl: `${hostUrl(isAdmin)}/${path}/${formId}`,
      systemName: getSystemName(taxonomy.speciesType),
      expertComment,
    },
  });
}

export function notifyOnRequestUpdate(
  email: string,
  status: string,
  requestId: number | string,
  requestType: string,
  isExpert: boolean = false,
  isAdmin: boolean = false,
  speciesTypes: string[],
  adminComment?: string,
) {
  const updateTypes: any = {
    [RequestStatus.CREATED]: 'Pateiktas',
    [RequestStatus.APPROVED]: 'Patvirtintas',
    [RequestStatus.REJECTED]: 'Atmestas',
    [RequestStatus.SUBMITTED]: 'Pateiktas pakartotinai',
    [RequestStatus.RETURNED]: 'Grąžintas taisymui',
  };
  const updateType = updateTypes[status] || '';

  const titleByType = {
    [RequestType.GET]: 'peržiūros žemėlapyje',
    [RequestType.GET_ONCE]: 'išrašo',
    [RequestType.CHECK]: 'tapti ekspertu',
  };

  if (!updateType) return;

  const path = isExpert || isAdmin ? 'rusys/prasymai' : 'prasymai';

  return client.sendEmailWithTemplate({
    From: sender,
    To: email.toLowerCase(),
    TemplateId: 41565554,
    TemplateModel: {
      title: updateType,
      titleText: updateType.toLowerCase(),
      requestType: `${isAdmin ? 'peržiūrai ' : ''}${titleByType[requestType]}`,
      actionUrl: `${hostUrl(isAdmin)}/${path}/${requestId}`,
      systemName: getSystemName(speciesTypes[0]),
      adminComment,
    },
  });
}

export function notifyOnFileGenerated(
  email: string,
  requestId: number | string,
  isExpert: boolean = false,
  isAdmin: boolean = false,
  speciesTypes: string[],
) {
  const path = isExpert || isAdmin ? 'rusys/prasymai' : 'prasymai';

  return client.sendEmailWithTemplate({
    From: sender,
    To: email.toLowerCase(),
    TemplateId: 41565550,
    TemplateModel: {
      actionUrl: `${hostUrl(isAdmin)}/${path}/${requestId}`,
      systemName: getSystemName(speciesTypes[0]),
    },
  });
}
