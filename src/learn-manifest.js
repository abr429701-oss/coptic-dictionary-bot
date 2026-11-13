// src/learn-manifest.js — snapshot of the "learn" tab (levels 1+2).
// Regenerated automatically by the deploy workflow's sync job
// (node scripts/generate-learn-manifest.mjs) every 30 minutes from the live
// "coptic" Sheet — when the Sheet changes, this file changes, the job
// commits it, the deploy follows, and the bot's scheduled tick re-imports
// the changed media. DO NOT edit by hand — regenerate instead.
// Column H ("الاستثناء") is ignored entirely by user instruction.
// The Worker never fetches the Sheet at runtime; the importer
// (/importlearn, or the scheduled auto-import) downloads each Drive file
// once from its public link, uploads it to Telegram, and stores the
// Telegram file_id.
export const LEARN_MANIFEST_VERSION = 1;
export const LEARN_LEVELS = [
  {
    "id": "m_learn_l1",
    "title": "المستوى الأول",
    "lessons": [
      {
        "id": "m_learn_l1_01",
        "title": "فيديو تعريفي عن اللغة القبطية",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1ZrWw4d-UUBGcWZyFiqc-pRQcWvQH3fE8",
            "label": "🎬 فيديو الدرس"
          }
        ]
      },
      {
        "id": "m_learn_l1_02",
        "title": "مقدمة عن حروف اللغة القبطية",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1c35DqxbMDhvdR52irXvrKjw6IGqym8i4",
            "label": "🎬 فيديو الدرس"
          }
        ]
      },
      {
        "id": "m_learn_l1_03",
        "title": "الدرس الاول",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1R7Hnl9cwwzgFKXnG63-B9_5i-qYAIjKC",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1IxPinWPhnvEUtNypz6tDu1TKy2QIM1Ym",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1Gts_xgdk3-g7elOTmSXtpouZMvFVLwdQ4fleO3usLYg/edit",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_04",
        "title": "الدرس الثاني",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1sD5PziUQu-8EQEJQIM-Yg_TShQTNhcGx",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1WZhG9eadkF5pf_WWx7TM7unb35_lMuuF",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1CFJ443YBu6a7oSBHV3vYQtkhJ8whTmKdTTWnf4fybkw/edit?usp=send_form",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_05",
        "title": "فيديو المراجعة الاولى",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1zToorIL8_FdjZvlSOXXQUWl9ldkAp1rf",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1BtPTPPzpEwp41LiyMPjDbXmec_bGob3B",
            "label": "🗣 الشفوي"
          }
        ]
      },
      {
        "id": "m_learn_l1_06",
        "title": "الدرس الثالث",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "12FrKVE54L-VELmZN1PY-hFlnEwSYgidT",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1vbrEqVNH49reRCd2iD3X2x9fgC1BneJ_",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/12Sdfv6FQe7Lr7LcXI3PLrxsp1g6ieeZuS94cvEUIgJo/edit?usp=send_form",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_07",
        "title": "الدرس الرابع",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "175oSfd2DTmaB3vDk6BRHM_0laavwXX9I",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1nFtwmujSehluUVNFV-pywlieipUW1_O0",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1DAYdD2pdtifeChZP9ChBGo4UV9fdJMkX7cRkwQ7zA7Q/edit?usp=send_form",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_08",
        "title": "فيديو المراجعة الثانية",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1qUBGvPG7PWixodGdv9zPqgXB7pKUZEsw",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1ywVDo5GZC20I4cA1XJpJkd26Eth5w50z",
            "label": "🗣 الشفوي"
          }
        ]
      },
      {
        "id": "m_learn_l1_09",
        "title": "الدرس الخامس",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1IhVT0JgwgtaIMyLhzRKSDTpEgLWnRRVQ",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1GBVWYH8c-QDF3VUZEkay0aF4gIqtYUtP",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1V8g6OpY12ewvSm2WEbJi2NFs1xu9bUg6AEaBSG0UYjU/edit?usp=send_form",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_10",
        "title": "الدرس السادس",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "156BMk1gPVvUoc6XYoI9MZSPvABisbWrh",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1MQWYyzPeJrP_saOpDndl_743H4XjjNmL",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1Ag4v_pX0xzh7BlBGFbzeBeAfFe2fo2oh__RkAQw6DUg/edit?usp=send_form",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_11",
        "title": "الدرس السابع",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1QnCSfPzzQeLVo51WNOvQySWy7GqCW9oO",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1J7TptmL0eMnb_geNwnPjpkI300On-KMB",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1bqoBpekkfa2_6oc-nwCdbOui5LDpRuVDCo7DaC1oi9o/edit?usp=send_form",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_12",
        "title": "الدرس الثامن",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1hCO6WXpIZ3jawx2TgFoYTPIGsBFNHVUI",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1ngCjTO1jAeVJEM-Fqltw34kEzplQuHi9",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1MiFcNOZwsIAptfRrSjl29Cpccf7SHoaSFBtZCfC1mLc/edit",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_13",
        "title": "الدرس التاسع",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1SbqpCZsH-cMM8J6Sphi0Me9yNT6of7mZ",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1Tk8ngqRTQx4LT_IugCSTpIvpZWS4v6Wi",
            "label": "🗣 الشفوي"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1ST9Nk2pWFjC_Sf_XfpW3wWgEaEq4gbT6r2fXN8mHqPc/edit",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l1_14",
        "title": "المراجعة النهائية الأولى",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1_Pcv2WLo7UfOio5soHSI_F934kNCW_Bz",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1T1PTDs9TA3wsEXfaKWK7QPYT8hCCNtwI",
            "label": "🗣 الشفوي"
          }
        ]
      },
      {
        "id": "m_learn_l1_15",
        "title": "المراجعة النهائية الثانية",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1GARqzKLjWXU6Rnr2aVZHsMaUKgndxiB3",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1I5WRb8EorgZd5yjmdevFCpHPhlR8zrqk",
            "label": "🗣 الشفوي"
          }
        ]
      },
      {
        "id": "m_learn_l1_16",
        "title": "المراجعة النهائية الثالثة",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1q5fP8_2sJ9eZ9CMCEiHc4sYImCQK3R40",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1RhzmRmYAsLAA8BhgycQ-MfFrKQFdsPDL",
            "label": "🗣 الشفوي"
          }
        ]
      },
      {
        "id": "m_learn_l1_17",
        "title": "المراجعة النهائية الرابعة",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1TDrzvbFfBSkMz1zMyWhNHgjNLGz7DCks",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1R_kzh3L6Hr52UU7USDJWDFHGNPUVzRWM",
            "label": "🗣 الشفوي"
          }
        ]
      }
    ]
  },
  {
    "id": "m_learn_l2",
    "title": "المستوى الثاني",
    "lessons": [
      {
        "id": "m_learn_l2_01",
        "title": "الدرس الاول",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1xBV4r1KF86WQDc3_I0qB8w7X7sd-w5gJ",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1QTCVEqPfP-dgJC_nj6Y6WxuaRLpkwOYF",
            "label": "🖼 ملخص الدرس"
          }
        ]
      },
      {
        "id": "m_learn_l2_02",
        "title": "الدرس الثاني",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1wfJwGx1ZMv_9A5Y8ta_BtTalxKJZA9AY",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "16C9uL9J2P7TponJDKFrh2_rlb2-dWVsg",
            "label": "🖼 ملخص الدرس"
          },
          {
            "key": "exercise",
            "kind": "text",
            "text": "التدريب الأول على الدرس الأول والثاني\n\n- وضح أصل هذه الكلمة يوناني أم قبطي مع التعليل (ϣⲁⲣ) ثم أنطق الكلمة صوتياً. \n\n- إذا علمت أن كلمة (Ⲗⲁⲥ) تعني (لسان) وهي كلمة مذكرة، فقم بكتابة الكلمات الآتية مع إضافة أداة التعريف العامة المناسبة وانطق الكلمات صوتياً بعد الكتابة. \n1- اللسان\n2- الالسنة\n\n- أزل أداة التعريف عن هذه الكلمة (ⲑ‌ⲙⲁⲩ) التي تعني (الأم) وضع أداة التنكير للمفرد لها ثم أنطق الكلمة صوتياً.\n\n............ \nتُرسل إجابة هذا التدريب على الواتساب وسيتم الرد عليك خلال أسبوع.",
            "label": "📝 التدريب"
          }
        ]
      },
      {
        "id": "m_learn_l2_03",
        "title": "الدرس الثالث",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1wpBCZ3kv3-ho2zWsKd23PGwunS4Yf8Sm",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1DcZV-GQFKj8O4Vk4VXSdYbEtwmOrqxTu",
            "label": "🖼 ملخص الدرس"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1hU9u45-62silHgZiehAneS0W7Ud6v-kpdEn9KkYYG78/edit?usp=send_form",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l2_04",
        "title": "الدرس الرابع",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1wpJo_l7LfrorUJB1ZqMqjJdwjxtc9bVk",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1tQnzk7yVEytCXlH18L-VeKRroCpu1D-f",
            "label": "🖼 ملخص الدرس"
          },
          {
            "key": "exercise",
            "kind": "text",
            "text": "التدريب الثاني على الدرس الثالث والرابع\nإجابته تُرسل مكتوبة على ورقة بدون أي ڤويس. \n\n- إذا علمت أن كلمة (ⲣⲱⲙⲓ) هي كلمة مذكرة وتعني (رجل) بناءاً على ذلك ترجم هذه العبارات:\n   + هو رجل\n   + هم رجال\n   + أنتم الرجال\n\n- إذا علمت أن كلمة (Ⲗⲁⲙⲡⲁⲥ) هي كلمة مذكرة وتعني (مصباح)،  و كلمة (ⲥⲱⲛⲙⲁⲩ) هي كلمة مؤنثة وتعني (خالة) فنرجو منك ترجمة هذه الكلمات:\n    + مصباحكَ\n    + مصباحها\n    + خالتي\n    + خالتهم\n    + خالتنا\n\n............... \nتُرسل إجابة هذا التدريب على الواتساب وسيتم الرد عليك خلال أسبوع.",
            "label": "📝 التدريب"
          }
        ]
      },
      {
        "id": "m_learn_l2_05",
        "title": "الدرس الخامس",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1wpq3IBloRiZxMjCodM-5dg6Po8dIIwkf",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1dpAxJQVMD3-yzFXDk5R1JvX4FSsruBkK",
            "label": "🖼 ملخص الدرس"
          }
        ]
      },
      {
        "id": "m_learn_l2_06",
        "title": "الدرس السادس",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1wrNmIR2ZgJQDB4GvK2SUQDv6hzcJYGyp",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1FMFeZaQS_HSG3xTHhCFmVsGlM1FalhS1",
            "label": "🖼 ملخص الدرس"
          },
          {
            "key": "exercise",
            "kind": "text",
            "text": "التدريب الثالث على الدرس الخامس والسادس\nإجابته تُرسل مكتوبة على ورقة بدون أي ڤويس. \n\n- إذا علمت أن (ⲤⲰ) هو فعل بمعنى (شَرِبَ)، و(ⲔⲰⲔ) فعل بمعني (نظف)، وكلمة (Ⲙⲱⲟⲩ) هي كلمة مذكرة وتعني (ماء)، وكلمة (Ⲙⲟⲛⲏ) هي كلمة مؤنثة وتعني (غُرفة)، وكلمة (ⲫⲱⲥ) هي كلمة مذكرة وتعني (نور)، وكلمة (ϣⲱϯ) هي كلمة مؤنثة وتعني (بئر). \n\nبناءاً على المُعطيات السابقة ترجم هذه العبارات جيداً مُراعياً القواعد اللازمة:\n   + أنا أشرب\n   + هي تُنظف\n   + نحن لا نُنظف\n   + هو لا يشرب مُطلقاً\n   + ماء البئر\n   + نور الغرفة\n \n\n- أكتب هذه الأرقام بحروف قبطية:\n   + 45\n   + 13\n   + 96\n   + 23\n \n.................\nتُرسل إجابة هذا التدريب على الواتساب وسيتم الرد عليك خلال أسبوع.",
            "label": "📝 التدريب"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1ZABUJwB07YtSWAWwpbMFWKfAc8krqlomf3bP-MNFDyY/edit",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l2_07",
        "title": "الدرس السابع",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1x0cSeF796PcaAXkyoV8ykSpfqksYURNE",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1Am86WnlekUrmma9BhT6JbRocYd_-YAw1",
            "label": "🖼 ملخص الدرس"
          }
        ]
      },
      {
        "id": "m_learn_l2_08",
        "title": "الدرس الثامن",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1ywN1rRH6hZOqqkOUHI-gD0r74etKtadO",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1uTTBUkjXb7eD8ZcT92lsBQlOsLgwdoDY",
            "label": "🖼 ملخص الدرس"
          },
          {
            "key": "exercise",
            "kind": "text",
            "text": "التدريب الرابع على الدرس السابع والثامن\nالتدريب الاخير\nإجابته تُرسل مكتوبة على ورقة بدون أي ڤويس. \n\n- ينام - - - - - > ⲛ̀ⲕⲟⲧ\n- يتكلم - - - - > Ⲥⲁϫⲓ\n- يسمع - - - - - > Ⲥⲱⲧⲉⲙ\n- يسأل - - - - - - > ϯϩⲟ\n- ⲕⲧⲓⲥⲓⲥ - - - - - - >  دُنيا (Ⲧ)\n.   ϫⲉⲣϫⲉⲣ - - - - - > يلعب\n- ϧⲟⲧϧⲉⲧ - - - - - > امتحان (ⲡ)\n- ⲁ̀ⲃⲟⲧ - - - - - - > شهر (ⲡ)\n\n+ وحرف (ⲡ) يدل على أن الكلمة مذكرة وحرف (ⲧ) يدل على أن الكلمة مؤنثة، فبناءاً على المُعطيات السابقة ترجم هذه العبارات جيداً مُراعياً القواعد اللازمة:\n   + هو لن ينام\n   + انتِ لم تتكلمي\n   + هم ناموا\n   + انتم سمعتم\n   + انتَ لا تتكلم مُطلقاً\n   + انتِ ستسألين\n \n\n+ اكتشف الخطأ في العبارات القبطية فيما يلي: \n- ⲛ̀ⲧⲉⲛⲁϫⲉⲣϫⲉⲣ ⲛⲁ\nانتِ لن تلعبي مُطلقاً\n\n- Ⲧ̀ⲙⲁⲩ ⲛ̀ⲧⲉ ⲡⲓⲕⲧⲓⲥⲓⲥ\nأم الدنيا\n\n- ⲡ̀ϧⲟⲧϧⲉⲧ ⲛ̀ϯⲁ̀ⲃⲟⲧ \nامتحان الشهر \n\n...........\nتُرسل إجابة هذا التدريب على الواتساب وسيتم الرد عليك خلال أسبوع.",
            "label": "📝 التدريب"
          },
          {
            "key": "exam",
            "kind": "url",
            "url": "https://docs.google.com/forms/d/1TF4YmrO2jIgdageOz-YOo9CAWMxheVd1MDnnFkp3vLU/edit?usp=send_form",
            "label": "📝 الامتحان الإلكتروني"
          }
        ]
      },
      {
        "id": "m_learn_l2_09",
        "title": "المراجعة النهائية الاولى",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "1-i-VB6Nrd6GTowo7gBC7JO9lRhXCMtSV",
            "label": "🎬 فيديو الدرس"
          }
        ]
      },
      {
        "id": "m_learn_l2_10",
        "title": "المراجعة النهائية الثانية",
        "items": [
          {
            "key": "video",
            "kind": "video",
            "driveId": "14svcapolBVRXPwxWcSY7_6jp6hb8QwWg",
            "label": "🎬 فيديو الدرس"
          }
        ]
      }
    ]
  }
];
