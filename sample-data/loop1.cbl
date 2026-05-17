       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOP1.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  I            PIC S9(9) COMP VALUE 0.
       01  J            PIC S9(9) COMP VALUE 0.
       01  K            PIC S9(9) COMP VALUE 0.
       01  L            PIC S9(9) COMP VALUE 0.
       01  M            PIC S9(9) COMP VALUE 0.
       01  N            PIC S9(9) COMP VALUE 0.
       01  O            PIC S9(9) COMP VALUE 0.
       01  SUM          PIC S9(18) COMP VALUE 0.
       01  TEMP         PIC S9(18) COMP VALUE 0.

       PROCEDURE DIVISION.

       MAIN-LOOP.
           PERFORM VARYING I FROM 1 BY 1 UNTIL I > 200
              PERFORM VARYING J FROM 1 BY 1 UNTIL J > 150
                 PERFORM VARYING K FROM 1 BY 1 UNTIL K > 100
                    PERFORM VARYING L FROM 1 BY 1 UNTIL L > 50
                       PERFORM VARYING M FROM 1 BY 1 UNTIL M > 25
                          PERFORM VARYING N FROM 1 BY 1 UNTIL N > 10
                                COMPUTE TEMP = I * J + K * L + M * N + O
                                ADD TEMP TO SUM
                          END-PERFORM
                       END-PERFORM
                    END-PERFORM
                 END-PERFORM
              END-PERFORM
           END-PERFORM

           DISPLAY "HEAVYLOOP SUM = " SUM
           STOP RUN.