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
            "driveId": "1UkxzYLLHZmrWftvxrNnhwCh_A00LHHU-",
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
            "driveId": "1ZPY8yH_U8f9ZcyyKW5ochz43emeB-s8X",
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
            "driveId": "1XoTji3Gv4EwYXr-0sy642N6NFVxxjLza",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1xmkBKNU0HAqWZTDdQnVm7y06EMwExoWM",
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
            "driveId": "1ah7Lw8zZGt8cQsL9-fqSg20uQ7Hd8qGs",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1t12y0V8SLu4ycXGhdc_L-kskqr3oOtUF",
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
            "driveId": "12Ha2__LYyYQ6ssWVgDN20xvdBsVcjxST",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1jsL_iQgGCNAg85wZw_7N1ks2yfnkbB_D",
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
            "driveId": "1SsIn57Q9qId9wPFmM_ZPNbahBL1GqQJc",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1jo99nrk1r_LEl394hhHQ7EOtyMbsZlTq",
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
            "driveId": "1AKE2TcbtaHHQEoTAcuTi0vnqYbs3s-dl",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1JOWFwTf2VKLn3kROjmnzTXQGPh_aNKdj",
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
            "driveId": "1sTrOT2hQxqDRjWtwRO96Jha2bKhgVagS",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1JWjpzQO-1KWazzXNDByPaiTPwv9GsyPO",
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
            "driveId": "1um3yvRSw_ZhuGM6wjewNYPiF6MXmTsWY",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "15TklFs-HieDLKUfRwQHUuI7rkdFURlmd",
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
            "driveId": "1kxhjsqUbhFpkEYNWHVIDSPHVPGEi4YtW",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1w_fmVPU29Pb5hEqFkNIhHleRj8wPF-UZ",
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
            "driveId": "1d8TGDCRLLhEGbtWBzLIAWjli1lCpDJRa",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "13F8dvAOiSraEknxLGmsWqUWYAn2NrSOn",
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
            "driveId": "1laDYBEKIKqN7DZc4BNXJgApvR1VPLvU0",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1qIQ8XENvEI8qWor7FM65gbcJ3jvJpzZM",
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
            "driveId": "1Gyewj57qCzL0zN4BqHLbCNBwQ_eSKuwR",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1bB6WM7QkZFzm7ImclC1oV5KcXHaKJi2n",
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
            "driveId": "1l4AyjgMmIvHkCYCpsTrkKlXY9iEH4qjx",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1JToQqiQkQbW91dnS9gTNK6PwvIwIH3ke",
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
            "driveId": "1MhtAUllCtPs8_SvWgcDsf-thw9O0k2hq",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1ZuguShPp__T36YEVNBNK7z61DhDZ4-LI",
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
            "driveId": "1XG2t5uzTVNpb3B1TuADEbSUSxYJ_4YUX",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1SS9NGrhP1XyJpw6-qPEGASzCKEz8lbeP",
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
            "driveId": "1GPCZCwTlJ8Rbo0J4OCjh_RFI5lZnWLkc",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "oral",
            "kind": "photo",
            "driveId": "1TgNogQf95j_KvOju2ZmKZd-7JdxpDTok",
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
            "driveId": "1was52OGtQ7eGtw_g5VLBVApwNeblcMtI",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1YMcSi07--nLb2JnoAwTZjy0W0nSePLUm",
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
            "driveId": "1l50hZgx2RNIJGyTsZ4VD_bOd-LjyVYZb",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1ZctKOIAr6pmBipNF_TTmVK1B8mdBiZx6",
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
            "driveId": "1OJvcKN3IWbogxGJRYyWJMYUjUgMfBxWK",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1GTdE58tsl34pMSPnHpiTNXOyWxF14C9S",
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
            "driveId": "1jiKxGodlTlwtPICtm5jw0VNdmd4aKS6F",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1vzPthQT2kcJvRG8gaCmBXcvF5jATSZNc",
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
            "driveId": "1nE9I9nDchHWsW_gobo2myLh_NUn2StE4",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1ib6Uspuo7vZUBdl5Y7DtmanZg1G-iox7",
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
            "driveId": "1RFQZn9dfyFvANqUWwcCgPLn5glmKvbt-",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "16Uq8Rcx0sN7Y4QX6mo_0w-fpf_OoP2sR",
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
            "driveId": "1sL-6OyIdvQczzE5-NuyYU5Pu-GobWWS8",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1qwWyLJnkcLC0VidhaZ1ghTQTNbAQuRLv",
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
            "driveId": "1PrIvIO3SI_hMDxxMR_ryz02nyPp84kx2",
            "label": "🎬 فيديو الدرس"
          },
          {
            "key": "summary",
            "kind": "photo",
            "driveId": "1X4-N5-5qTaA3CvPGzmN9MsD5wlSNN1Y4",
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
            "driveId": "1rC26EqOHdmneve3PlbUnt2GjfWTe6745",
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
            "driveId": "1V2KSvwi-8_IQy2HM_rzj--v7fYo6lk0t",
            "label": "🎬 فيديو الدرس"
          }
        ]
      }
    ]
  }
];
