import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from '../lib/theme';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

function B({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bold}>{children}</Text>;
}

export default function GuideScreen() {
  return (
    <ScrollView style={{ backgroundColor: C.page }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.intro}>
        이 앱에 나오는 지표들의 의미를 초보자 눈높이로 정리했습니다. 모든 지표는 과거 가격에서
        계산된 <B>확률적 참고 자료</B>이며, 미래 수익을 보장하지 않습니다.
      </Text>

      <Section title="RSI (상대강도지수)">
        <P>
          최근 14일간 오른 힘과 내린 힘의 비율을 0~100으로 나타냅니다.{'\n'}
          • <B>30 이하 = 과매도</B>: 많이 팔려서 가격이 눌린 상태 → 반등 여지가 있다고 해석{'\n'}
          • <B>70 이상 = 과매수</B>: 많이 사서 과열된 상태 → 조정 가능성 경계{'\n'}
          30/70은 법칙이 아니라 <B>관례적 기준</B>입니다. 강한 추세장에서는 RSI가 70 위에 오래
          머물기도 하니, 다른 지표와 함께 보세요.
        </P>
      </Section>

      <Section title="이동평균선 (SMA)">
        <P>
          최근 N일 종가의 평균을 이은 선입니다. 기간이 짧을수록 단기 흐름을, 길수록 큰 추세를
          보여줍니다.{'\n'}
          • <B>5일선</B>: 초단기 (1주){'\n'}
          • <B>20일선</B>: 단기 (1개월) — "생명선"이라고도 부름{'\n'}
          • <B>60일선</B>: 중기 (3개월, 분기){'\n'}
          • <B>120일선</B>: 장기 (6개월, 반기)
        </P>
      </Section>

      <Section title="골든크로스 / 데드크로스">
        <P>
          • <B>골든크로스</B>: 단기선(5일)이 장기선(20일)을 <B>아래→위로</B> 뚫는 것. 최근 상승
          힘이 붙었다는 신호로 매수 관점에서 해석{'\n'}
          • <B>데드크로스</B>: 반대로 <B>위→아래로</B> 뚫는 것. 하락 전환 경고{'\n'}
          다만 이미 오른 뒤에 늦게 나타나는 후행 신호라, 발생 직후 급반락하는 "속임수"도 있습니다.
        </P>
      </Section>

      <Section title="정배열 추세">
        <P>
          <B>현재가 &gt; 20일선 &gt; 60일선</B> 순서로 위에서부터 나란히 놓인 상태. 단기·중기 모두
          우상향 중이라는 뜻으로, 상승 추세가 살아있다고 해석합니다. (반대로 놓이면 역배열 = 하락
          추세)
        </P>
      </Section>

      <Section title="이평선 괴리율 (종목 카드의 '20일선 −11.9%')">
        <P>
          현재가가 그 이동평균선보다 몇 % 위/아래에 있는지입니다.{'\n'}
          • <B>+면 이평선 위</B> (강세), <B>−면 아래</B> (약세){'\n'}• 괴리가 크게 벌어지면(예:
          −12%) 평균으로 되돌아가려는 힘이 생기기도 합니다 — 과대낙폭 반등 노림의 근거로 쓰임
        </P>
      </Section>

      <Section title="MACD">
        <P>
          12일·26일 지수이동평균의 차이로 <B>추세의 방향과 힘</B>을 봅니다. MACD선이 자신의
          평균선(시그널선)을 <B>위로 뚫으면 상향 교차 = 상승 모멘텀</B>, 아래로 뚫으면 하향 교차 =
          하락 모멘텀으로 해석합니다.
        </P>
      </Section>

      <Section title="볼린저밴드">
        <P>
          20일 평균선 위아래로 변동성(표준편차×2)만큼 띠를 두른 것. 가격은 통계적으로 밴드 안에
          있을 확률이 높습니다.{'\n'}
          • <B>하단 이탈</B>: 과하게 빠짐 → 반등 관심{'\n'}• <B>상단 이탈</B>: 과열 → 조정 경계
          {'\n'}단, 강한 뉴스·추세에서는 밴드를 타고 계속 가기도 합니다("밴드 타기").
        </P>
      </Section>

      <Section title="거래량 배수 (거래량 2.4x)">
        <P>
          오늘 거래량이 <B>최근 20일 평균의 몇 배</B>인지입니다. 2배(🔥) 이상이면 시장의 관심이
          급격히 몰렸다는 뜻 — 뉴스, 실적, 세력 진입 등 "이유"가 있을 가능성이 높아 급등주
          필터로 사용합니다. 거래량 없는 상승보다 거래량 실린 상승이 신뢰도가 높다고 봅니다.
        </P>
      </Section>

      <Section title="시그널 점수 (점수 50)">
        <P>
          이 앱이 시그널마다 가중치를 매겨 합산한 값입니다.{'\n'}
          골든크로스 +30 · RSI 과매도 +25 · MACD 상향 +20 · 정배열 +15 · 밴드 하단 이탈 +15{'\n'}
          데드크로스 −30 · RSI 과매수 −25 · MACD 하향 −20 · 밴드 상단 이탈 −15{'\n'}
          점수가 높을수록 "매수 관점 신호가 겹쳐 있다"는 의미일 뿐, 매수 추천 확정이 아닙니다.
        </P>
      </Section>

      <Text style={styles.disclaimer}>
        ⚠ 기술 지표는 과거 데이터의 요약일 뿐 미래를 보장하지 않습니다. 특히 급등주는 변동성이
        극단적으로 큽니다. 모든 투자 판단과 손익의 책임은 투자자 본인에게 있습니다.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  intro: { color: C.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 6 },
  section: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    padding: 14,
    marginTop: 10,
  },
  title: { color: C.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  body: { color: C.textSecondary, fontSize: 13, lineHeight: 21 },
  bold: { color: C.text, fontWeight: '700' },
  disclaimer: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 16, textAlign: 'center' },
});
