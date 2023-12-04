import { ServerClient } from 'postmark';
import { FormStatus } from '../services/forms.service';
import { RequestStatus, RequestType } from '../services/requests.service';
import { Taxonomy } from '../services/taxonomies.service';
const client = new ServerClient(process.env.POSTMARK_KEY);

const sender = 'noreply@biip.lt';

export function emailCanBeSent() {
  return ['production'].includes(process.env.NODE_ENV);
}

function hostUrl(isAdmin: boolean = false) {
  return isAdmin ? process.env.ADMIN_HOST : process.env.APP_HOST;
}

export function notifyFormAssignee(email: string, formId: number | string, species: Taxonomy) {
  return client.sendEmailWithTemplate({
    From: sender,
    To: email.toLowerCase(),
    TemplateId: 30501356,
    TemplateModel: {
      species: species.speciesName,
      speciesLatin: species.speciesNameLatin,
      actionUrl: `${hostUrl()}/rusys/stebejimo-anketos/${formId}`,
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
    TemplateId: 30501358,
    TemplateModel: {
      title: updateType,
      titleText: updateType.toLowerCase(),
      species: taxonomy.speciesName,
      speciesLatin: taxonomy.speciesNameLatin,
      actionUrl: `${hostUrl(isAdmin)}/${path}/${formId}`,
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
    [RequestType.CHECK]: 'prašymas tapti ekspertu',
  };

  if (!updateType) return;

  const path = isExpert || isAdmin ? 'rusys/prasymai' : 'prasymai';

  return client.sendEmailWithTemplate({
    From: sender,
    To: email.toLowerCase(),
    TemplateId: 30565763,
    TemplateModel: {
      title: updateType,
      titleText: updateType.toLowerCase(),
      requestType: `${isAdmin ? 'peržiūrai ' : ''}${titleByType[requestType]}`,
      actionUrl: `${hostUrl(isAdmin)}/${path}/${requestId}`,
    },
  });
}

export function notifyOnFileGenerated(
  email: string,
  requestId: number | string,
  isExpert: boolean = false,
  isAdmin: boolean = false,
) {
  const path = isExpert || isAdmin ? 'rusys/prasymai' : 'prasymai';

  return client.sendEmailWithTemplate({
    From: sender,
    To: email.toLowerCase(),
    TemplateId: 30565767,
    TemplateModel: {
      actionUrl: `${hostUrl(isAdmin)}/${path}/${requestId}`,
    },
  });
}
