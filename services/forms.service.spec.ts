jest.mock('../utils/mails', () => ({
  emailCanBeSent: () => false,
  notifyFormAssignee: jest.fn(),
  notifyOnFormUpdate: jest.fn(),
}));

// forms.service reaches taxonomies.species.service before requests.service, which leaves
// requests.service with an undefined enum; loading requests.service first unwinds the cycle.
import './requests.service';

import { FormStatus } from '../types';
import FormsService from './forms.service';
import { User, UserType } from './users.service';

type FormRow = {
  id: number;
  status: string;
  assigneeId: number | null;
  createdBy: number;
  speciesId: number;
};

type ValidateAssignee = (
  this: unknown,
  args: {
    ctx: { meta: { user?: Partial<User>; profile?: unknown } };
    value: number | null;
    entity: FormRow;
  },
) => Promise<true | string>;

type ListAssignees = (
  this: unknown,
  ctx: {
    params: { id: number };
    meta: { user?: Partial<User>; profile?: unknown };
    call: (action: string, params?: unknown) => Promise<unknown>;
  },
) => Promise<{ rows: Array<{ id: number }>; total: number }>;

const { validateAssignee, listAssignees, expertCanReassign, isSpeciesExpert } =
  FormsService.prototype as unknown as {
    validateAssignee: ValidateAssignee;
    listAssignees: ListAssignees;
    expertCanReassign: unknown;
    isSpeciesExpert: unknown;
  };

const SPECIES = 7;
const AUTHOR = 1;
const HOLDER = 2;
const OTHER_EXPERT = 3;
const NOT_AN_EXPERT = 4;

const speciesByExpert: Record<number, number[]> = {
  [AUTHOR]: [SPECIES],
  [HOLDER]: [SPECIES],
  [OTHER_EXPERT]: [SPECIES],
  [NOT_AN_EXPERT]: [],
};

const serviceSelf = () => ({
  expertCanReassign,
  isSpeciesExpert,
  broker: {
    call: async (action: string, params: { userId: number }) => {
      if (action === 'requests.getExpertSpecies') return speciesByExpert[params.userId] ?? [];
      throw new Error(`unexpected call: ${action}`);
    },
  },
});

const expert = (id: number): Partial<User> => ({
  id,
  type: UserType.USER,
  isExpert: true,
  expertSpecies: [SPECIES],
});

const admin: Partial<User> = { id: 99, type: UserType.ADMIN, isExpert: false, expertSpecies: [] };

const form = (overrides: Partial<FormRow> = {}): FormRow => ({
  id: 10,
  status: FormStatus.SUBMITTED,
  assigneeId: HOLDER,
  createdBy: AUTHOR,
  speciesId: SPECIES,
  ...overrides,
});

const assign = (user: Partial<User>, value: number | null, entity: FormRow) =>
  validateAssignee.call(serviceSelf(), { ctx: { meta: { user } }, value, entity });

describe('validateAssignee — an expert handing the form to another expert', () => {
  it('lets the holder pick another expert of the species', async () => {
    await expect(assign(expert(HOLDER), OTHER_EXPERT, form())).resolves.toBe(true);
  });

  it.each([FormStatus.RETURNED, FormStatus.REJECTED, FormStatus.APPROVED])(
    'refuses a %s form',
    async (status) => {
      await expect(assign(expert(HOLDER), OTHER_EXPERT, form({ status }))).resolves.toBe(
        'Cannot assign to somebody else.',
      );
    },
  );

  it('refuses an expert who does not hold the form', async () => {
    await expect(
      assign(expert(HOLDER), OTHER_EXPERT, form({ assigneeId: OTHER_EXPERT })),
    ).resolves.toBe('Cannot assign to somebody else.');
  });

  it('refuses a target who is not an expert of this species', async () => {
    await expect(assign(expert(HOLDER), NOT_AN_EXPERT, form())).resolves.toBe(
      'Assignee cannot be set.',
    );
  });

  it('refuses the author of the form', async () => {
    await expect(assign(expert(HOLDER), AUTHOR, form())).resolves.toBe('Cannot assign to creator.');
  });
});

describe('validateAssignee — the rules that were already there', () => {
  it('lets an expert take an unassigned form', async () => {
    await expect(assign(expert(HOLDER), HOLDER, form({ assigneeId: null }))).resolves.toBe(true);
  });

  it('refuses an expert taking a form somebody else holds', async () => {
    await expect(assign(expert(HOLDER), HOLDER, form({ assigneeId: OTHER_EXPERT }))).resolves.toBe(
      'Assignee already exists.',
    );
  });

  it('refuses an expert unassigning somebody else', async () => {
    await expect(assign(expert(HOLDER), null, form({ assigneeId: OTHER_EXPERT }))).resolves.toBe(
      'Cannot unassign others.',
    );
  });

  it('lets an admin assign any expert of the species', async () => {
    await expect(assign(admin, OTHER_EXPERT, form({ assigneeId: null }))).resolves.toBe(true);
  });

  it('refuses an admin assigning somebody who is not an expert of the species', async () => {
    await expect(assign(admin, NOT_AN_EXPERT, form({ assigneeId: null }))).resolves.toBe(
      'Assignee cannot be set.',
    );
  });
});

describe('listAssignees', () => {
  const listFor = (user: Partial<User>, status: string, assignee: number | null) => {
    const call = async (action: string) => {
      if (action === 'forms.resolve') {
        return { id: 10, status, assignee, createdBy: AUTHOR, species: SPECIES };
      }
      if (action === 'requests.getExpertsIdsBySpecies') return [AUTHOR, HOLDER, OTHER_EXPERT];
      if (action === 'users.resolve') return [];
      throw new Error(`unexpected call: ${action}`);
    };

    const seen: number[][] = [];

    return listAssignees
      .call(serviceSelf(), {
        params: { id: 10 },
        meta: { user },
        call: async (action: string, params?: unknown) => {
          if (action === 'users.resolve') seen.push((params as { id: number[] }).id);
          return call(action);
        },
      })
      .then(() => seen[0]);
  };

  it('offers the holder every expert of the species except the author', async () => {
    await expect(listFor(expert(HOLDER), FormStatus.SUBMITTED, HOLDER)).resolves.toEqual([
      HOLDER,
      OTHER_EXPERT,
    ]);
  });

  it('offers an expert who does not hold the form only himself', async () => {
    await expect(listFor(expert(HOLDER), FormStatus.SUBMITTED, null)).resolves.toEqual([HOLDER]);
  });

  it('offers the holder of a returned form only himself', async () => {
    await expect(listFor(expert(HOLDER), FormStatus.RETURNED, HOLDER)).resolves.toEqual([HOLDER]);
  });

  it('offers an admin every expert of the species except the author', async () => {
    await expect(listFor(admin, FormStatus.SUBMITTED, HOLDER)).resolves.toEqual([
      HOLDER,
      OTHER_EXPERT,
    ]);
  });
});
