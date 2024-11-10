'use strict';

import moleculer, { Context, ServiceBroker } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { faker } from '@faker-js/faker';
import { FormType } from './forms.types.service';
const fs = require('fs');

@Service({
  name: 'seed',
})
export default class SeedService extends moleculer.Service {
  @Action()
  async real(ctx: Context<Record<string, unknown>>) {
    const usersCount: number = await ctx.call('users.count');

    if (!usersCount) {
      const data: any[] = await ctx.call('auth.getSeedData');

      for (const item of data) {
        await ctx.call('auth.createUserWithTenantsIfNeeded', {
          authUser: item,
          authUserGroups: item.groups,
        });
      }
    }

    const conventionsCount: number = await ctx.call('conventions.count');
    if (!conventionsCount) {
      await this.seedConventions(ctx);
    }

    const eunisCount: number = await ctx.call('forms.settings.eunis.count');
    if (!eunisCount) {
      await this.seedEunis();
    }

    const sourcesCount: number = await ctx.call('forms.settings.sources.count');
    if (!sourcesCount) {
      await this.seedSources();
    }

    const optionsCount: number = await ctx.call('forms.settings.options.count');
    if (!optionsCount) {
      await this.seedOptions();
    }

    return true;
  }

  @Action()
  async fake(ctx: Context<Record<string, unknown>>) {
    const kingdomsCount: number = await ctx.call('taxonomies.kingdoms.count');

    if (!kingdomsCount) {
      await this.seedTaxonomies(ctx);
    }
    return true;
  }

  @Method
  async seedConventions(ctx: Context) {
    try {
      const conventions = JSON.parse(
        fs.readFileSync(process.cwd() + '/seed/conventions.json', 'utf8'),
      );

      const createConvention = (convention: any, parent?: any) => {
        return ctx.call('conventions.create', {
          name: convention.name,
          code: convention.code,
          description: convention.description,
          parent,
        });
      };

      const iterateConventions = (items: any[], parent?: any) => {
        return Promise.all(
          items.map(async (item) => {
            const newItem: any = await createConvention(item, parent);
            if (item.items) {
              await iterateConventions(item.items, newItem.id);
            }

            return newItem;
          }),
        );
      };

      await iterateConventions(conventions.items);
    } catch (err) {
      console.error(err);
    }
  }

  @Method
  async seedTaxonomies(ctx: Context) {
    const parseTaxonomiesFromFiles = () => {
      try {
        const kingdoms = JSON.parse(fs.readFileSync(process.cwd() + '/seed/kingdoms.json', 'utf8'));
        const phylums = JSON.parse(fs.readFileSync(process.cwd() + '/seed/phylums.json', 'utf8'));
        const species = JSON.parse(fs.readFileSync(process.cwd() + '/seed/species.json', 'utf8'));
        const classes = JSON.parse(fs.readFileSync(process.cwd() + '/seed/classes.json', 'utf8'));

        const getNewItem = (item: any, innerItems: any = {}) => {
          const newItem: any = {
            name: item.properties.NAME_LT,
            nameLatin: item.properties.NAME_LATIN,
          };

          if (item.properties.SPC_DESCRIPTION)
            newItem.description = item.properties.SPC_DESCRIPTION;
          if (item.properties.ID_SPECIES) newItem.globalId = item.properties.ID_SPECIES;
          if (innerItems && innerItems[item.properties.ORIGINAL_ID])
            newItem.items = innerItems[item.properties.ORIGINAL_ID] || [];
          return newItem;
        };

        const convertToKeyData = (data: object[], name: string, innerItems: any = {}) => {
          return data.reduce((acc: any, item: any) => {
            const key: string = item.properties[name];
            acc[key] = acc[key] || [];

            acc[key].push(getNewItem(item, innerItems));
            return acc;
          }, {});
        };

        const speciesByClassId = convertToKeyData(species.features, 'SPC_CLASSES_ID');
        const classesByPhylumId = convertToKeyData(
          classes.features,
          'SPC_TYPES_ID',
          speciesByClassId,
        );
        const phylumsByKingdomId = convertToKeyData(
          phylums.features,
          'SPC_KINGDOMS_ID',
          classesByPhylumId,
        );

        let result: any = [];
        kingdoms.features.forEach((i: any) => {
          result.push(getNewItem(i, phylumsByKingdomId));
        });

        return result;
      } catch (err) {
        console.error(err);
      }
    };

    const createNew = (callKey: string, data: any) =>
      ctx.call<any, Partial<any>>(`${callKey}.create`, data);

    const getData = (data: any, innerKey: string = '', innerItem: any = {}) => {
      const newData: any = {
        nameLatin: data.nameLatin,
        name: data.name,
      };

      if (data.description) newData.description = data.description;
      if (data.globalId) newData.globalId = data.globalId;
      if (innerKey) newData[innerKey] = innerItem.id;
      return newData;
    };

    const hasItems = (item: any, cb: any) =>
      item.items && item.items.length && item.items.forEach((i: any) => cb(i));

    const kingdoms = parseTaxonomiesFromFiles() || [];
    kingdoms.forEach(async (kingdom: any) => {
      const taxonomyKingdom = await createNew('taxonomies.kingdoms', getData(kingdom));

      hasItems(kingdom, async (phylum: any) => {
        const taxonomyPhylum = await createNew(
          'taxonomies.phylums',
          getData(phylum, 'kingdom', taxonomyKingdom),
        );

        hasItems(phylum, async (oneClass: any) => {
          const taxonomyClass = await createNew(
            'taxonomies.classes',
            getData(oneClass, 'phylum', taxonomyPhylum),
          );

          hasItems(oneClass, async (species: any) => {
            await createNew('taxonomies.species', getData(species, 'class', taxonomyClass));
          });
        });
      });
    });
  }

  @Method
  seedEunis() {
    const values = [
      { name: 'Smėlio paplūdimio sąnašynų bendrijos', code: 'B1.1' },
      { name: 'Smėlio paplūdimiai aukščiau sąnašų linijos', code: 'B1.2' },
      { name: 'Pustomos pajūrio kopos', code: 'B1.3' },
      { name: 'Stabilių pajūrio smėlynų žolynai', code: 'B1.4' },
      { name: 'Pajūrio smėlynų tyruliai', code: 'B1.5' },
      { name: 'Pajūrio kopų krūmynai', code: 'B1.6' },
      { name: 'Pajūrio kopų miškai', code: 'B1.7' },
      { name: 'Pajūrio kopų drėgnos ir šlapios įlomės', code: 'B1.8' },
      { name: 'Sąnašų linijos gargždo paplūdimiai', code: 'B2.1' },
      {
        name: 'Atviri judraus gargždo paplūdimiai aukščiau sąnašų linijos',
        code: 'B2.2',
      },
      { name: 'Minkšti pajūrio klifai', code: 'B3.1' },
      { name: 'Nuolatiniai oligotrofiniai vandens telkiniai', code: 'C1.1' },
      { name: 'Nuolatiniai mezotrofiniai vandens telkiniai', code: 'C1.2' },
      {
        name: 'Neišdžiūstantys eutrofiniai ežerai, tvenkiniai, kūdros',
        code: 'C1.3',
      },
      { name: 'Pastovūs distrofiniai vandens telkiniai', code: 'C1.4' },
      { name: 'Gipso karsto ežerai', code: 'C1.5' },
      {
        name: 'Laikini ežerai, tvenkiniai, balos (vandeningasis laikotarpis)',
        code: 'C1.6',
      },
      { name: 'Šaltiniai ir šaltinių upeliai', code: 'C2.1' },
      { name: 'Nuolatinės sraunios upės', code: 'C2.2' },
      { name: 'Nuolatinės lėtos tėkmės upės', code: 'C2.3' },
      { name: 'Jūrinės upių žiotys', code: 'C2.4' },
      {
        name: 'Laikini tekantys vandenys (vandeningasis laikotarpis)',
        code: 'C2.5',
      },
      { name: 'Sausinamųjų kanalų ir griovių vandens tėkmės', code: 'C2.6' },
      { name: 'Smulkiųjų helofitų bendrijos', code: 'C3.1' },
      { name: 'Aukštųjų helofitų sąžalynai', code: 'C3.2' },
      { name: 'Daugiamečių būdmainių augalų bendrijos', code: 'C3.3' },
      {
        name: 'Periodiškai užliejamų krantų pionierinė ir efemerinė augalija',
        code: 'C3.4',
      },
      {
        name: 'Neapaugę krantai, padengti minkštomis arba judriomis nuosėdomis',
        code: 'C3.5',
      },
      {
        name: 'Neapaugę arba negausiai apaugę krantai su nejudriu substratu',
        code: 'C3.6',
      },
      { name: 'Aktyvios, sąlyginai nepažeistos aukštapelkės', code: 'D1.1' },
      { name: 'Pažeistos, nekaupiančios durpių aukštapelkės', code: 'D1.2' },
      { name: 'Aukštapelkių krūmynai', code: 'D1.3' },
      { name: 'Rūgščios žemapelkės', code: 'D2.1' },
      { name: 'Tarpinės pelkės ir liūnai', code: 'D2.2' },
      { name: 'Turtingos žemapelkės ir jų aukštieji žolynai', code: 'D3.1' },
      { name: 'Drėgnieji aukštųjų helofitų sąžalynai', code: 'D4.1' },
      {
        name: 'Viksvuolinių augalų sąžalynai išdžiūstančiose augimvietėse',
        code: 'D4.2',
      },
      { name: 'Pelkiniai vikšrių sąžalynai', code: 'D4.3' },
      {
        name: 'Žemyninių druskingų augimviečių helofitų bendrijos',
        code: 'D5.1',
      },
      {
        name: 'Pionierinė nekalkingų smėlynų ir nuobirynų augalija',
        code: 'R1-2',
      },
      { name: 'Pionierinė karbonatinių uolienų augalija', code: 'R1-3' },
      { name: 'Stepinės pievos', code: 'R1-A' },
      { name: 'Rūgščios ir neutralios sauspievės', code: 'R1-M' },
      { name: 'Rūgščios smiltpievės', code: 'R1-P' },
      { name: 'Žemyninių smėlynų ir kopų nesusivėrę žolynai', code: 'R1-Q' },
      { name: 'Ilgalaikės mezotrofinės šienaujamos ganyklos', code: 'R2-1' },
      { name: 'Ilgalaikės šienaujamos pievos', code: 'R2-2' },
      {
        name: 'Drėgnos ir šlapios mezotrofinės ir eutrofinės pievos',
        code: 'R3-5',
      },
      {
        name: 'Drėgnos ir šlapios mezotrofinės ir eutrofinės ganyklos',
        code: 'R3-6',
      },
      { name: 'Drėgnos ir šlapios oligotrofinės pievos', code: 'R3-7' },
      { name: 'Termofilinės bazinių dirvožemių pamiškės', code: 'R5-1' },
      { name: 'Acidofilinės pamiškės', code: 'R5-2' },
      { name: 'Skėstašakio šakio sąžalynai', code: 'R5-4' },
      { name: 'Drėgni aukštųjų žolių apkraščiai ir sąžalynai', code: 'R5-5' },
      { name: 'Naujos kirtavietės', code: 'R5-7' },
      { name: 'Sausieji šlaitų kadagynai', code: 'S3-1' },
      { name: 'Gervuogynai ir avietynai', code: 'S3-2' },
      { name: 'Dygliuotieji krūmynai', code: 'S3-5' },
      { name: 'Lazdynynai', code: 'S3-7' },
      { name: 'Natūralūs miško jaunuolynai', code: 'S3-8' },
      { name: 'Durpyniniai viržynai', code: 'S4-1' },
      { name: 'Sausieji viržynai', code: 'S4-2' },
      { name: 'Paupiniai ir paežeriniai gluosnynai', code: 'S9-1' },
      { name: 'Pelkiniai gluosnynai', code: 'S9-3' },
      { name: 'Pakrančių medynai', code: 'T1-1' },
      { name: 'Drėgnieji aliuviniai miškai', code: 'T1-2' },
      { name: 'Sausieji aliuviniai miškai', code: 'T1-3' },
      { name: 'Nerūgštūs pelkiniai lapuotynai', code: 'T1-5' },
      { name: 'Rūgštūs pelkiniai lapuotynai ', code: 'T1-6' },
      { name: 'Termofiliniai lapuočių miškai', code: 'T1-9' },
      { name: 'Acidofiliniai ąžuolynai', code: 'T1-B' },
      { name: 'Sausieji smulkialapių medynai', code: 'T1-C' },
      { name: 'Nemoraliniai lapuočių medynai', code: 'T1-E' },
      { name: 'Griovų ir šlaitų miškai', code: 'T1-F' },
      { name: 'Sausieji baltalksnynai', code: 'T1-G' },
      { name: 'Nevietinių lapuočių miško plantacijos', code: 'T1-H' },
      { name: 'Termofiliniai pušynai', code: 'T3-5' },
      { name: 'Vakarų taigos eglynai', code: 'T3-F' },
      { name: 'Vakarų taigos pušynai', code: 'T3-G' },
      { name: 'Pelkiniai pušynai', code: 'T3-J' },
      { name: 'Pelkiniai eglynai', code: 'T3-K' },
      { name: 'Miško jaunuolynai', code: 'T4-1' },
      { name: 'Žemaliemeniai medynai', code: 'T4-2' },
      { name: 'Intensyvūs monokultūrų pasėliai', code: 'V1-1' },
      { name: 'Mišrūs prekiniai daržai ir sodai', code: 'V1-2' },
      { name: 'Mažai intensyvūs monokultūrų pasėliai', code: 'V1-3' },
      { name: 'Užimti pūdymai ir dirvonai', code: 'V1-5' },
      { name: 'Dideli gėlynų plotai', code: 'V2-1' },
      { name: 'Maži gėlynai ir priesodybiniai želdyniai', code: 'V2-2' },
      { name: 'Neseniai apleistų daržų ir gėlynų plotai', code: 'V2-3' },
      {
        name: 'Sukultūrinti, persėti ir smarkiai tręšiami žolynai',
        code: 'V3-1',
      },
      { name: 'Trypiami sausieji vienmečių žolynai', code: 'V3-4' },
      { name: 'Trypiami mezofiliniai vienmečių žolynai', code: 'V3-5' },
      { name: 'Vienmečių žolių antropogeninė augalija', code: 'V3-7' },
      {
        name: 'Sausų vietų daugiamečių žolių antropogeninė augalija',
        code: 'V3-8',
      },
      { name: 'Daugiametė antropogeninė mezofitų augalija', code: 'V3-9' },
      { name: 'Svetimžemių augalų gyvatvorės', code: 'V4-1' },
      { name: 'Karpomos vietinių augalų gyvatvorės', code: 'V4-2' },
      { name: 'Vietinių rūšių turtingos gyvatvorės', code: 'V4-3' },
      { name: 'Vietinių rūšių skurdžios gyvatvorės', code: 'V4-4' },
      { name: 'Vytelinių gluosnių plantacijos', code: 'V5-2' },
      { name: 'Vaiskrūmių ir žemaūgių vaismedžių sodai', code: 'V5-3' },
      { name: 'Vynuogynai', code: 'V5-4' },
      { name: 'Vaismedžių sodai ir riešutynai', code: 'V6-1' },
      { name: 'Medžių eilės', code: 'V6-3' },
      { name: 'Maži antropogeniniai lapuočių medynai', code: 'V6-4' },
      { name: 'Maži antropogeniniai spygliuočių medynai', code: 'V6-6' },
    ];

    return Promise.all(
      values.map((value) => {
        this.broker.call('forms.settings.eunis.create', {
          name: value.name,
          code: value.code,
        });
      }),
    );
  }

  @Method
  seedSources() {
    const values = [
      'Apklausų duomenys',
      'Duomenų bazės',
      'Mokslinės publikacijos',
      'Kolekcijos',
      'Ekspertų užrašai',
      'Tiesioginis stebėjimas',
      'Kita',
    ];

    return Promise.all(
      values.map((value) => {
        this.broker.call('forms.settings.sources.create', {
          name: value,
        });
      }),
    );
  }

  @Method
  seedOptions() {
    const values = [
      {
        name: 'EGG',
        value: 'Kiaušinis',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'LARVA',
        value: 'Lerva',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'IMMATURE',
        value: 'Jaunas, nesubrendęs individas',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'PUPA',
        value: 'Lėliukė',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'DEAD',
        value: 'Negyvas individas',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'MATURE',
        value: 'Suaugęs individas',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_ANIMAL,
      },

      {
        name: 'VEGETATING',
        value: 'Daigas/vegetuojantis augalas',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_PLANT,
      },
      {
        name: 'BLOOMING',
        value: 'Žydintis augalas',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_PLANT,
      },
      {
        name: 'GROWING',
        value: 'Augantis augalas',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_PLANT,
      },
      {
        name: 'FRUIT_BEARING',
        value: 'Vaisius duodantis augalas',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_PLANT,
      },
      {
        name: 'DRY',
        value: 'Sausas (nudžiūvęs) augalas, augalo liekanos',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_PLANT,
      },
      {
        name: 'GROWING',
        value: 'Augantis grybas arba kerpė',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_MUSHROOM,
      },
      {
        name: 'DRIED_UP',
        value: 'Sudžiūvęs grybas ar kerpė',
        group: 'EVOLUTION',
        formType: FormType.ENDANGERED_MUSHROOM,
      },
      {
        name: 'FAECES',
        value: 'Išmatos',
        group: 'ACTIVITY',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'CUD',
        value: 'Išvamos (atrajos)',
        group: 'ACTIVITY',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'HABITATION',
        value: 'Lizdas, ola ir pan',
        group: 'ACTIVITY',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'OBSERVED_FOOTPRINT',
        value: 'Stebėti pėdsakai',
        group: 'ACTIVITY',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'OBSERVED_ALIVE',
        value: 'Stebėtas gyvas (praskrendantis, besimaitinantis ir kt.)',
        group: 'ACTIVITY',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'OTHER',
        value: 'Kiti buvimo požymiai (balsai ir kt.)',
        group: 'ACTIVITY',
        formType: FormType.ENDANGERED_ANIMAL,
      },
      {
        name: 'OBSERVATION',
        value: 'Stebėjimas',
        group: 'METHOD',
        formType: FormType.INVASIVE_FISH,
      },
      {
        name: 'AMATEUR_FISHING_TOOLS',
        value: 'Sugauta mėgėjiškais žūklės įrankiais',
        group: 'METHOD',
        formType: FormType.INVASIVE_FISH,
      },
      {
        name: 'SPECIAL_FISHING_TOOLS',
        value: 'Sugauta specialiosios žūklės įrankiais',
        group: 'METHOD',
        formType: FormType.INVASIVE_FISH,
      },
      {
        name: 'OTHER',
        value: 'Kita',
        group: 'METHOD',
        formType: FormType.INVASIVE_FISH,
      },
      {
        name: 'OBSERVATION',
        value: 'Stebėjimas',
        group: 'METHOD',
        formType: FormType.INVASIVE_CRUSTACEAN,
      },
      {
        name: 'AMATEUR_FISHING_TOOLS',
        value: 'Sugauta mėgėjiškais žūklės įrankiais',
        group: 'METHOD',
        formType: FormType.INVASIVE_CRUSTACEAN,
      },
      {
        name: 'SPECIAL_FISHING_TOOLS',
        value: 'Sugauta specialiosios žūklės įrankiais',
        group: 'METHOD',
        formType: FormType.INVASIVE_CRUSTACEAN,
      },
      {
        name: 'LANDING_NET',
        value: 'Rankinis graibštas',
        group: 'METHOD',
        formType: FormType.INVASIVE_CRUSTACEAN,
      },
      {
        name: 'OTHER',
        value: 'Kita',
        group: 'METHOD',
        formType: FormType.INVASIVE_CRUSTACEAN,
      },
      {
        name: 'OBSERVATION',
        value: 'Stebėjimas',
        group: 'METHOD',
        formType: FormType.INVASIVE_MOLLUSK,
      },
      {
        name: 'TRAP',
        value: 'Gaudyklė',
        group: 'METHOD',
        formType: FormType.INVASIVE_MOLLUSK,
      },
      {
        name: 'COLLECTION',
        value: 'Rinkimas',
        group: 'METHOD',
        formType: FormType.INVASIVE_MOLLUSK,
      },
      {
        name: 'LANDING_NET',
        value: 'Rankinis graibštas',
        group: 'METHOD',
        formType: FormType.INVASIVE_MOLLUSK,
      },
      {
        name: 'OTHER',
        value: 'Kita',
        group: 'METHOD',
        formType: FormType.INVASIVE_MOLLUSK,
      },
      {
        name: 'ACCOUNTING',
        value: 'Apskaita',
        group: 'METHOD',
        formType: FormType.INVASIVE_MAMMAL,
      },
      {
        name: 'SURVEY',
        value: 'Apklausa',
        group: 'METHOD',
        formType: FormType.INVASIVE_MAMMAL,
      },
      {
        name: 'OBSERVATION',
        value: 'Stebėjimas',
        group: 'METHOD',
        formType: FormType.INVASIVE_MAMMAL,
      },
      {
        name: 'CAMERA',
        value: 'Rinkimas',
        group: 'METHOD',
        formType: FormType.INVASIVE_MAMMAL,
      },
      {
        name: 'TRAP',
        value: 'Spąstai',
        group: 'METHOD',
        formType: FormType.INVASIVE_MAMMAL,
      },
      {
        name: 'DEAD_INDIVIDUALS_REGISTRATION',
        value: 'Keliuose žuvusių individų registravimas',
        group: 'METHOD',
        formType: FormType.INVASIVE_MAMMAL,
      },
      {
        name: 'OTHER',
        value: 'Kita',
        group: 'METHOD',
        formType: FormType.INVASIVE_MAMMAL,
      },
      {
        name: 'VALUE_0',
        value: '0 - nerasta nei vieno individo.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_1',
        value: '1 - pasitaiko tik pavienių individų, jie užima 0,1% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_2',
        value: '2 - augalai pasklidę nedideliame plote ir užima ne daugiau kaip 1% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_3',
        value: '3 - augalai pasklidę visame kontūre, bet užima ne daugiau kaip 1% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_4',
        value:
          '4 - augalai auga pavieniui arba nedidelėmis grupėmis, užima nuo 1% iki 10% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_5',
        value:
          '5 - augalai auga pavieniui arba grupėmis dalyje kontūro ir užima nuo 20% iki 40% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_6',
        value:
          '6 - augalai ar jų sąžalynai pasklidę po visą kontūrą ir užima nuo 20% iki 40% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_7',
        value:
          '7 - augalai ar jų sąžalynai pasitaiko dalyje kontūro, bet jie užima nuo 40% iki 60% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_8',
        value:
          '8 - augalai ar jų sąžalynai pasklidę po visą kontūrą ir užima nuo 40% iki 60% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_9',
        value: '9 - augalai sudaro didelius sąžalynus ir užima nuo 60% iki 80% buveinės ploto.',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'VALUE_10',
        value:
          '10 - augalai sudaro beveik ištisinį sąžalyną ir užima daugiau kaip 80% buveinės ploto',
        group: 'METHOD',
        formType: FormType.INVASIVE_PLANT,
      },
      {
        name: 'RESEARCH',
        value: 'Buvo vykdomas tyrimas',
        group: 'NO_QUANTITY_REASON',
        formType: FormType.INVASIVE,
      },
      {
        name: 'CLEANUP',
        value: 'Invazinė rūšis išnaikinta',
        group: 'NO_QUANTITY_REASON',
        formType: FormType.INVASIVE,
      },
    ];

    return Promise.all(
      values.map((value) => {
        this.broker.call('forms.settings.options.create', value);
      }),
    );
  }

  async started(): Promise<void> {
    this.broker
      .waitForServices([
        'auth',
        'users',
        'tenants',
        'conventions',
        'forms.settings.eunis',
        'forms.settings.sources',
        'forms.settings.options',
        'taxonomies.classes',
        'taxonomies.kingdoms',
        'taxonomies.phylums',
        'taxonomies.species',
      ])
      .then(async () => {
        await this.broker.call('seed.real', {}, { timeout: 120 * 1000 });

        if (process.env.NODE_ENV !== 'production') {
          await this.broker.call('seed.fake', {}, { timeout: 120 * 1000 });
        }
      });
  }
}
